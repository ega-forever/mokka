const EventEmitter = require('eventemitter3'),
  Tick = require('tick-tock'),
  crypto = require('crypto'),
  secrets = require('secrets.js-grempe'),
  one = require('one-time'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Web3 = require('web3'),
  web3 = new Web3(),
  EthUtil = require('ethereumjs-util'),
  emits = require('emits');

/**
 * Generate a somewhat unique UUID.
 *
 * @see stackoverflow.com/q/105034
 * @returns {String} UUID.
 * @private
 */
function UUID () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function gen (c) {
    var random = Math.random() * 16 | 0
      , value = c !== 'x'
      ? (random & 0x3 | 0x8)
      : random;

    return value.toString(16);
  });
}

/**
 * Emit when modifications are made.
 *
 * @type {Fucntion}
 * @private
 */
const change = require('modification')(' change');

/**
 * A nope function for when people don't want message acknowledgements. Because
 * they don't care about CAP.
 *
 * @private
 */
function nope () {
}

/**
 * Representation of a single raft node in the cluster.
 *
 * Options:
 *
 * - `address`: An unique id of this given node.
 * - `heartbeat`: Heartbeat timeout.
 * - `election min`: Minimum election timeout.
 * - `election max`: Maximum election timeout.
 * - `threshold`: Threshold when the heartbeat RTT is close to the election
 *   timeout.
 * - `Log`: A Log constructor that should be used to store commit logs.
 * - `state`: Our initial state. This is a private property and should not be
 *   set you unless you know what your are doing but as you want to use this
 *   property I highly doubt that that..
 *
 * Please note, when adding new options make sure that you also update the
 * `Raft#join` method so it will correctly copy the new option to the clone as
 * well.
 *
 * @constructor
 * @param {Mixed} address Unique address, id or name of this given raft node.
 * @param {Object} options Raft configuration.
 * @public
 */
class Raft extends EventEmitter {
  constructor (address, options = {}) {
    super();

    let raft = this;

    if ('object' === typeof address) options = address;
    else if (!options.address) options.address = address;

    raft.election = {
      min: options.election_min || 150,
      max: options.election_max || 300
    };

    raft.beat = options.heartbeat || 50;

    raft.votes = {
      for: null,                // Who did we vote for in this current term.
      granted: 0                // How many votes we're granted to us.
    };

    raft.write = raft.write || options.write || null;
    raft.threshold = options.threshold || 0.8;
    raft.address = options.address || UUID();
    raft.timers = new Tick(raft);
    raft.Log = options.Log;
    raft.change = change;
    raft.emits = emits;
    raft.latency = 0;
    raft.log = null;
    raft.nodes = [];
    raft.privateKey = options.privateKey;
    raft.peers = options.peers;

    //
    // Raft §5.2:
    //
    // When a server starts, it's always started as Follower and it will remain in
    // this state until receive a message from a Leader or Candidate.
    //
    raft.state = options.state || Raft.FOLLOWER;    // Our current state.
    raft.leader = '';                               // Leader in our cluster.
    raft.term = 0;                                  // Our current term.

    raft._initialize(options);
  }

  /**
   * Initialize Raft and start listening to the various of events we're
   * emitting as we're quite chatty to provide the maximum amount of flexibility
   * and reconfigurability.
   *
   * @param {Object} options The configuration you passed in the constructor.
   * @private
   */
  _initialize (options) {
    let raft = this;

    //
    // Reset our vote as we're starting a new term. Votes only last one term.
    //
    raft.on('term change', function change () {
      raft.votes.for = null;
      raft.votes.granted = 0;
    });

    //
    // Reset our times and start the heartbeat again. If we're promoted to leader
    // the heartbeat will automatically be broadcasted to users as well.
    //
    raft.on('state change', function change (state) {
      raft.timers.clear('heartbeat, election');
      raft.heartbeat(Raft.LEADER === raft.state ? raft.beat : raft.timeout());
      raft.emit(Raft.states[state].toLowerCase());
    });

    //
    // Receive incoming messages and process them.
    //
    raft.on('data', async (packet, write) => {
      write = write || nope;
      let reason;

      if ('object' !== raft.type(packet)) {
        reason = 'Invalid packet received';
        raft.emit('error', new Error(reason));

        return write(await raft.packet('error', reason));
      }


      if (packet.term > raft.term) {
        raft.change({
          leader: Raft.LEADER === packet.state ? packet.address : packet.leader || raft.leader,
          state: Raft.FOLLOWER,
          term: packet.term
        });
      } else if (packet.term < raft.term) {
        reason = 'Stale term detected, received `' + packet.term + '` we are at ' + raft.term;
        raft.emit('error', new Error(reason));

        return write(raft.packet('error', reason));
      }

      if (Raft.LEADER === packet.state) {
        if (Raft.FOLLOWER !== raft.state)
          raft.change({state: Raft.FOLLOWER});

        if (packet.address !== raft.leader)
          raft.change({leader: packet.address});

        raft.heartbeat(raft.timeout());
      }

      if (packet.type === 'vote') {
        if (raft.votes.for && raft.votes.for !== packet.address) {
          raft.emit('vote', packet, false);
          return write(await raft.packet('voted', {granted: false}));
        }

        if (raft.log) {
          const {index, term} = await raft.log.getLastInfo();

          if (index > packet.last.index && term > packet.last.term) {
            raft.emit('vote', packet, false);
            return write(await raft.packet('voted', {granted: false}));
          }
        }

        raft.votes.for = packet.address;
        raft.emit('vote', packet, true);
        raft.change({leader: packet.address, term: packet.term});
        write(await raft.packet('voted', {granted: true}));
        raft.heartbeat(raft.timeout());
        return;
      }

      if (packet.type === 'voted') {
        if (Raft.CANDIDATE !== raft.state) {
          return write(await raft.packet('error', 'No longer a candidate, ignoring vote'));
        }

        if (packet.data.granted) {
          raft.votes.granted++;
        }

        if (raft.quorum(raft.votes.granted)) {
          raft.change({leader: raft.address, state: Raft.LEADER});
          raft.message(Raft.FOLLOWER, await raft.packet('append'));
        }
        write();
        return;
      }

      if (packet.type === 'error') {
        raft.emit('error', new Error(packet.data));
        return;
      }

      if (packet.type === 'append') {
        const {term, index} = await raft.log.getLastInfo();

        if (packet.last.index !== index && packet.last.index !== 0) {
          const hasIndex = await raft.log.has(packet.last.index);

          if (hasIndex) raft.log.removeEntriesAfter(packet.last.index);
          else return raft.message(Raft.LEADER, await raft.packet('append fail', {
            term: packet.last.term,
            index: packet.last.index
          }));
        }

        if (packet.data) {
          const entry = packet.data[0];
          await raft.log.saveCommand(entry.command, entry.term, entry.index);

          raft.message(Raft.LEADER, await raft.packet('append ack', {
            term: entry.term,
            index: entry.index
          }));
        }

        if (raft.log.committedIndex < packet.last.committedIndex) {
          const entries = await raft.log.getUncommittedEntriesUpToIndex(packet.last.committedIndex, packet.last.term);
          raft.commitEntries(entries);
        }

        return;
      }

      if (packet.type === 'append ack') {
        const entry = await raft.log.commandAck(packet.data.index, packet.address);
        if (raft.quorum(entry.responses.length) && !entry.committed) {
          const entries = await raft.log.getUncommittedEntriesUpToIndex(entry.index, entry.term);
          raft.commitEntries(entries);
        }

        this.emit('append_ack', entry.index);
        return;
      }

      if (packet.type === 'append fail') {
        const previousEntry = await raft.log.get(packet.data.index);
        const append = await raft.appendPacket(previousEntry);
        write(append);
        return;
      }


      if (packet.type === 'task_vote') {
        this.voteTask(packet.data.taskId, packet.data.share, packet.address, packet.term);
        return;
      }

      if (packet.type === 'task_voted') {
        this.votedTask(packet.data.taskId, packet.data.payload, packet.address);
        return;
      }


      if (packet.type === 'task_executed') {
        this.executedTask(packet.data.taskId, packet.data.payload, packet.address);
        return;
      }


      if (raft.listeners('rpc').length) {
        raft.emit('rpc', packet, write);
      } else {
        write(await raft.packet('error', 'Unknown message type: ' + packet.type));
      }


    });


    if (Raft.CHILD === raft.state)
      return raft.emit('initialize');

    if ('function' === raft.type(raft.Log)) {
      raft.log = new raft.Log(raft, options);
    }

    /**
     * The raft is now listening to events so we can start our heartbeat timeout.
     * So that if we don't hear anything from a leader we can promote our selfs to
     * a candidate state.
     *
     * Start listening listening for heartbeats when implementors are also ready
     * with setting up their code.
     *
     * @api private
     */
    function initialize (err) {
      if (err) return raft.emit('error', err);

      raft.emit('initialize');
      raft.heartbeat(raft.timeout());
    }

    if ('function' === raft.type(raft.initialize)) {
      if (raft.initialize.length === 2) return raft.initialize(options, initialize);
      raft.initialize(options);
    }

    initialize();
  }

  /**
   * Proper type checking.
   *
   * @param {Mixed} of Thing we want to know the type of.
   * @returns {String} The type.
   * @private
   */
  type (of) {
    return Object.prototype.toString.call(of).slice(8, -1).toLowerCase();
  }

  /**
   * Check if we've reached our quorum (a.k.a. minimum amount of votes requires
   * for a voting round to be considered valid) for the given amount of votes.
   *
   * @param {Number} responses Amount of responses received.
   * @returns {Boolean}
   * @public
   */
  quorum (responses) {
    if (!this.nodes.length || !responses) return false;

    return responses >= this.majority();
  }

  /**
   * The majority required to reach our the quorum.
   *
   * @returns {Number}
   * @public
   */
  majority () {
    return Math.ceil(this.nodes.length / 2) + 1;
  }

  /**
   * Attempt to run a function indefinitely until the callback is called.
   *
   * @param {Function} attempt Function that needs to be attempted.
   * @param {Function} fn Completion callback.
   * @param {Number} timeout Which timeout should we use.
   * @returns {Raft}
   * @public
   */
  indefinitely (attempt, fn, timeout) {
    let uuid = UUID(),
      raft = this;

    (function again () {
      //
      // We need to force async execution here because we do not want to saturate
      // the event loop with sync executions. We know that it's important these
      // functions are retried indefinitely but if it's called synchronously we will
      // not have time to receive data or updates.
      //
      var next = one(function force (err, data) {
        if (!raft.timers) return; // We're been destroyed, ignore all.

        raft.timers.setImmediate(uuid + '@async', function async () {
          if (err) {
            raft.emit('error', err);

            return again();
          }

          fn(data);
        });
      });

      //
      // Ensure that the assigned callback has the same context as our raft.
      //
      attempt.call(raft, next);

      raft.timers.setTimeout(uuid, function timeoutfn () {
        next(new Error('Timed out, attempting to retry again'));
      }, +timeout || raft.timeout());
    }());

    return this;
  }

  /**
   * Start or update the heartbeat of the Raft. If we detect that we've received
   * a heartbeat timeout we will promote our selfs to a candidate to take over the
   * leadership.
   *
   * @param {String|Number} duration Time it would take for the heartbeat to timeout.
   * @returns {Raft}
   * @private
   */
  heartbeat (duration) {
    let raft = this;

    duration = duration || raft.beat;

    if (raft.timers.active('heartbeat')) {
      raft.timers.adjust('heartbeat', duration);

      return raft;
    }

    raft.timers.setTimeout('heartbeat', async () => {
      if (Raft.LEADER !== raft.state) {
        raft.emit('heartbeat timeout');

        return raft.promote();
      }

      //
      // According to the raft spec we should be sending empty append requests as
      // heartbeat. We want to emit an event so people can modify or inspect the
      // payload before we send it. It's also a good indication for when the
      // idle state of a LEADER as it didn't get any messages to append/commit to
      // the FOLLOWER'S.
      //
      let packet = await raft.packet('append');

      raft.emit('heartbeat', packet);
      raft.message(Raft.FOLLOWER, packet).heartbeat(raft.beat);
    }, duration);

    return raft;
  }

  /**
   * Send a message to connected nodes within our cluster. The following messaging
   * patterns (who) are available:
   *
   * - Raft.LEADER   : Send a message to cluster's current leader.
   * - Raft.FOLLOWER : Send a message to all non leaders.
   * - Raft.CHILD    : Send a message to everybody.
   * - <address>     : Send a message to a raft based on the address.
   *
   * @param {Mixed} who Recipient of the message.
   * @param {Mixed} what The data we need to send.
   * @param {Function} when Completion callback
   * @returns {Raft}
   * @public
   */
  message (who, what, when) {
    when = when || nope;

    //
    // If the "who" is undefined, the developer made an error somewhere. Tell them!
    //
    if (typeof who === 'undefined') {
      throw new Error('Cannot send message to `undefined`. Check your spelling!');
    }

    let output = {errors: {}, results: {}},
      length = this.nodes.length,
      errors = false,
      latency = [],
      raft = this,
      nodes = [],
      i = 0;

    switch (who) {
      case Raft.LEADER:
        for (; i < length; i++)
          if (raft.leader === raft.nodes[i].address) {
            nodes.push(raft.nodes[i]);
          }
        break;

      case Raft.FOLLOWER:
        for (; i < length; i++)
          if (raft.leader !== raft.nodes[i].address) {
            nodes.push(raft.nodes[i]);
          }
        break;

      case Raft.CHILD:
        Array.prototype.push.apply(nodes, raft.nodes);
        break;

      default:
        for (; i < length; i++)
          if (who === raft.nodes[i].address) {
            nodes.push(raft.nodes[i]);
          }
    }

    /**
     * A small wrapper to force indefinitely sending of a certain packet.
     *
     * @param {Raft} client Raft we need to write a message to.
     * @param {Object} data Message that needs to be send.
     * @api private
     */
    function wrapper (client, data) {
      let start = +new Date();

      client.write(data, function written (err, data) {
        latency.push(+new Date() - start);

        //
        // Add the error or output to our `output` object to be
        // passed to the callback when all the writing is done.
        //
        if (err) {
          errors = true;
          output.errors[client.address] = err;
        } else {
          output.results[client.address] = data;
        }

        //
        // OK, so this is the strange part here. We've broadcasted messages and
        // got replies back. This reply contained data so we need to process it.
        // What if the data is incorrect? Then we have no way at the moment to
        // send back reply to a reply to the server.
        //
        if (err) raft.emit('error', err);
        else if (data) raft.emit('data', data);

        //
        // Messaging has been completed.
        //
        if (latency.length === length) {
          raft.timing(latency);
          when(errors ? output.errors : undefined, output.results);
          latency.length = nodes.length = 0;
          output = null;
        }
      });
    }

    length = nodes.length;
    i = 0;

    for (; i < length; i++) {
      wrapper(nodes[i], what);
    }

    return raft;
  };

  /**
   * Generate the various of timeouts.
   *
   * @returns {Number}
   * @private
   */
  timeout () {
    let times = this.election;
    return Math.floor(Math.random() * (times.max - times.min + 1) + times.min);
  }

  /**
   * Calculate if our average latency causes us to come dangerously close to the
   * minimum election timeout.
   *
   * @param {Array} latency Latency of the last broadcast.
   * @param {Boolean} Success-fully calculated the threshold.
   * @private
   */
  timing (latency) {
    let raft = this,
      sum = 0,
      i = 0;

    if (Raft.STOPPED === raft.state) return false;

    for (; i < latency.length; i++) {
      sum += latency[i];
    }

    raft.latency = Math.floor(sum / latency.length);

    if (raft.latency > raft.election.min * raft.threshold) {
      raft.emit('threshold');
    }

    return true;
  }

  /**
   * Raft §5.2:
   *
   * We've detected a timeout from the leaders heartbeats and need to start a new
   * election for leadership. We increment our current term, set the CANDIDATE
   * state, vote our selfs and ask all others rafts to vote for us.
   *
   * @returns {Raft}
   * @private
   */
  async promote () {
    let raft = this;

    raft.change({
      state: Raft.CANDIDATE,  // We're now a candidate,
      term: raft.term + 1,    // but only for this term.
      leader: ''              // We no longer have a leader.
    });

    //
    // Candidates are always biased and vote for them selfs first before sending
    // out a voting request to all other rafts in the cluster.
    //
    raft.votes.for = raft.address;
    raft.votes.granted = 1;

    //
    // Broadcast the voting request to all connected rafts in your private
    // cluster.
    //
    const packet = await raft.packet('vote');

    raft.message(Raft.FOLLOWER, packet);

    //
    // Set the election timeout. This gives the rafts some time to reach
    // consensuses about who they want to vote for. If no consensus has been
    // reached within the set timeout we will attempt it again.
    //
    raft.timers
      .clear('heartbeat, election')
      .setTimeout('election', raft.promote, raft.timeout());

    return raft;
  }

  /**
   * Wrap the outgoing messages in an object with additional required data.
   *
   * @async
   * @param {String} type Message type we're trying to send.
   * @param {Mixed} data Data to be transfered.
   * @returns {Promise<Object>} Packet.
   * @private
   */
  async packet (type, data) {
    let raft = this,
      wrapped = {
        state: raft.state,    // Are we're a leader, candidate or follower.
        term: raft.term,     // Our current term so we can find mis matches.
        address: raft.address,  // Address of the sender.
        type: type,          // Message type.
        leader: raft.leader   // Who is our leader.
      };

    //
    // If we have logging and state replication enabled we also need to send this
    // additional data so we can use it determine the state of this raft.
    //
    if (raft.log) wrapped.last = await raft.log.getLastInfo();
    if (arguments.length === 2) wrapped.data = data;

    return wrapped;
  }

  /**
   * appendPacket - Send append message with entry and using the previous entry as the last.index and last.term
   *
   * @param {Entry} entry Entry to send as data
   *
   * @return {Promise<object>} Description
   * @private
   */
  async appendPacket (entry) {
    const raft = this;
    const last = await raft.log.getEntryInfoBefore(entry);
    return {
      state: raft.state,    // Are we're a leader, candidate or follower.
      term: raft.term,     // Our current term so we can find mis matches.
      address: raft.address,  // Address of the sender.
      type: 'append',      // Append message type .
      leader: raft.leader,   // Who is our leader.
      data: [entry], // The command to send to the other nodes
      last
    };
  }

  /**
   * Create a clone of the current instance with the same configuration. Ideally
   * for creating connected nodes in a cluster.. And let that be something we're
   * planning on doing.
   *
   * @param {Object} options Configuration that should override the default config.
   * @returns {Raft} The newly created instance.
   * @public
   */
  clone (options) { //todo replace with lodash
    options = options || {};

    let raft = this,
      node = {
        Log: raft.Log,
        election_max: raft.election.max,
        election_min: raft.election.min,
        heartbeat: raft.beat,
        threshold: raft.threshold
      }, key;

    for (key in node) {
      if (key in options || !node.hasOwnProperty(key)) continue;

      options[key] = node[key];
    }

    return new raft.constructor(options);
  }

  /**
   * A new raft is about to join the cluster. So we need to upgrade the
   * configuration of every single raft.
   *
   * @param {String} address The address of the raft that is connected.
   * @param {Function} write A method that we use to write data.
   * @returns {Raft} The raft we created and that joined our cluster.
   * @public
   */
  join (address, write) {
    let raft = this;

    // can be function or asyncfunction
    if (/function/.test(raft.type(address))) {
      write = address;
      address = null;
    }

    //
    // You shouldn't be able to join the cluster as your self. So we're going to
    // add a really simple address check here. Return nothing so people can actually
    // check if a raft has been added.
    //
    if (raft.address === address) return;

    let node = raft.clone({
      write: write,       // Optional function that receives our writes.
      address: address,   // A custom address for the raft we added.
      state: Raft.CHILD   // We are a raft in the cluster.
    });

    node.once('end', function end () {
      raft.leave(node);
    }, raft);

    raft.nodes.push(node);
    raft.emit('join', node);

    return node;
  }

  /**
   * Remove a raft from the cluster.
   *
   * @param {String} address The address of the raft that should be removed.
   * @returns {Raft} The raft that we removed.
   * @public
   */
  leave (address) {
    let raft = this,
      index = -1,
      node;

    for (let i = 0; i < raft.nodes.length; i++) {
      if (raft.nodes[i] === address || raft.nodes[i].address === address) {
        node = raft.nodes[i];
        index = i;
        break;
      }
    }

    if (~index && node) {
      raft.nodes.splice(index, 1);

      if (node.end) node.end();
      raft.emit('leave', node);
    }

    return node;
  }

  /**
   * This Raft needs to be shut down.
   *
   * @returns {Boolean} Successful destruction.
   * @public
   */
  end () {
    let raft = this;

    if (Raft.STOPPED === raft.state) return false;
    raft.change({state: Raft.STOPPED});

    if (raft.nodes.length)
      for (let i = 0; i < raft.nodes.length; i++)
        raft.leave(raft.nodes[i]);


    raft.emit('end');
    raft.timers.end();
    raft.removeAllListeners();

    if (raft.log)
      raft.log.end();

    raft.timers = raft.Log = raft.beat = raft.election = null;
    return true;
  }


  async proposeTask (task) {

    if (this.state !== Raft.LEADER) {
      await Promise.delay(this.election.max);
      await this.promote(); //todo decide about promote

      await new Promise(res => this.once('leader', res)).timeout(this.election.max).catch(() => {
      });

      if (this.state !== Raft.LEADER)
        return await this.proposeTask(task);
    }
    // about to send an append so don't send a heart beat
    // raft.heartbeat(raft.beat);
    const entry = await this.log.saveCommand({task: task}, this.term);
    const appendPacket = await this.appendPacket(entry);
    this.message(Raft.FOLLOWER, appendPacket);
    return entry;
  }

  async reserveTask (taskId) {
    if (this.state !== Raft.LEADER) {
      await Promise.delay(this.election.max);
      await this.promote(); //todo decide about promote

      await new Promise(res => this.once('leader', res)).timeout(this.election.max).catch(() => {
      });

      if (this.state !== Raft.LEADER)
        return await this.reserveTask(taskId);
    }

    let timeout = 1000 * 60 * 5; //5 min //todo calculate (predict the difficulty of task)
    const entry = await this.log.saveCommand({reserve: taskId, timeout: timeout}, this.term);
    const appendPacket = await this.appendPacket(entry);
    this.message(Raft.FOLLOWER, appendPacket);


    await new Promise(res => {
      const eventCallBack = async (index) => {
        if (index !== entry.index)
          return;

        const item = await this.log.get(entry.index);

        if (item.responses.length < this.majority())
          return;

        this.removeListener('append_ack', eventCallBack);
        res();
      };

      this.on('append_ack', eventCallBack);
    }).timeout(this.election.max * 2).catch(() => {
      return Promise.reject({code: 0, message: `quorum hasn't been reached for task ${taskId}`});
    });


    return entry;
  }

  async executeTask (taskId) {

    if (!(await this.log.isReserved(taskId)))
      return Promise.reject({code: 0, message: 'task is not reserved!'});

    let addresses = _.chain(this.nodes)
      .filter(node => [Raft.FOLLOWER, Raft.CHILD].includes(node.state))
      .map(node => node.address).value();

    let minValidates = Math.round(addresses.length / 2);

    if (minValidates === 1)
      minValidates = Object.keys(this.peers).length;

    let taskSuper = await this.log.get(taskId);
    let task = taskSuper.command.task;

    if (addresses.length < 2)
      return await this.executedTask(taskId); //skip vote as no node for vote available

    let id = crypto.createHash('md5').update(JSON.stringify(task)).digest('hex');
    let shares = secrets.share(id, addresses.length, minValidates);

    await this.log.setMinShare(taskId, minValidates);//todo set lock on tasks

    for (let index = 0; index < addresses.length; index++) {
      let packet = await this.packet('task_vote', {taskId: taskId, share: shares[index]});
      await this.message(addresses[index], packet);
    }
  }


  async voteTask (taskId, share, peer, term) {

    if (term > this.term) {
      await Promise.delay(this.election.max);
      return await this.voteTask(taskId, share, peer, term);
    }

    let isTaskExist = await this.log.has(taskId);
    if (!isTaskExist)
      return;

    const signedShare = web3.eth.accounts.sign(share, `0x${this.privateKey}`);
    let packet = await this.packet('task_voted', {taskId: taskId, payload: signedShare});
    await this.message(peer, packet);
  }

  async votedTask (taskId, payload, peer) {

    const publicKey = EthUtil.ecrecover(Buffer.from(payload.messageHash.replace('0x', ''), 'hex'), parseInt(payload.v), Buffer.from(payload.r.replace('0x', ''), 'hex'), Buffer.from(payload.s.replace('0x', ''), 'hex'));

    if (!this.peers.includes(publicKey.toString('hex')))
      return;


    let entry = await this.log.appendShare(taskId, payload.message, peer);


    if (entry.minShares > entry.shares.length)
      return;

    let shares = entry.shares.map(item => item.share);

    let id = crypto.createHash('md5').update(JSON.stringify(entry.command.task)).digest('hex');
    let comb = secrets.combine(shares);

    if (comb !== id)
      return; //todo remove task


    if (entry.minShares === entry.shares.length)
      await this.executedTask(taskId);


  }

  async executedTask (taskId) {

    if (this.state !== Raft.LEADER) {
      await Promise.delay(this.election.max);
      await this.promote(); //todo decide about promote

      await new Promise(res => this.once('leader', res)).timeout(this.election.max).catch(() => null);

      if (this.state !== Raft.LEADER)
        return await this.executedTask(taskId);
    }

    const executedEntry = await this.log.saveCommand({executed: taskId}, this.term);
    const appendPacket = await this.appendPacket(executedEntry);
    this.message(Raft.FOLLOWER, appendPacket);
    return executedEntry;
  }


  /**
   * commitEntries - Commites entries in log and emits commited entries
   *
   * @param {Entry[]} entries Entries to commit
   * @return {Promise<void>}
   */
  async commitEntries (entries) {
    entries.forEach(async (entry) => {
      await this.log.commit(entry.index);
      this.emit('commit', entry.command);
    });
  }
}

/**
 * Raft §5.1:
 *
 * A Raft can be in only one of the various states. The stopped state is not
 * something that is part of the Raft protocol but something we might want to
 * use internally while we're starting or shutting down our node. The following
 * states are generated:
 *
 * - STOPPED:   Assume we're dead.
 * - LEADER:    We're selected as leader process.
 * - CANDIDATE: We want to be promoted to leader.
 * - FOLLOWER:  We're just following a leader.
 * - CHILD:     A node that has been added using JOIN.
 *
 * @type {Number}
 * @private
 */
Raft.states = 'STOPPED,LEADER,CANDIDATE,FOLLOWER,CHILD'.split(',');
for (let s = 0; s < Raft.states.length; s++) {
  Raft[Raft.states[s]] = s;
}

module.exports = Raft;
