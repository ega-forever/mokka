const EventEmitter = require('eventemitter3'),
  Tick = require('tick-tock'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  TaskActions = require('./actions/taskActions'),
  Multiaddr = require('multiaddr'),
  hashUils = require('./utils/hashes'),
  NodeActions = require('./actions/nodeActions'),
  MessageActions = require('./actions/messageActions'),
  emits = require('emits');

const change = require('modification')(' change');

class Raft extends EventEmitter {
  constructor (options = {}) {
    super();

    //let raft = this;

    TaskActions(this);
    NodeActions(this);
    MessageActions(this);

    this.election = {
      min: options.election_min || 150,
      max: options.election_max || 300
    };

    this.beat = options.heartbeat || 50;

    this.votes = {
      for: null,                // Who did we vote for in this current term.
      granted: 0                // How many votes we're granted to us.
    };

    this.write = this.write || options.write || null;
    this.threshold = options.threshold || 0.8;
    this.timers = new Tick(this);
    this.Log = options.Log;
    this.change = change;
    this.emits = emits;
    this.latency = 0;
    this.log = null;
    this.nodes = [];
    this.privateKey = options.privateKey;
    this.publicKey = options.privateKey ? Wallet.fromPrivateKey(Buffer.from(options.privateKey, 'hex')).getPublicKey().toString('hex') : options.publicKey;
    this.peers = options.peers;

    try {
      const multiaddr = Multiaddr(options.address);
      const mOptions = multiaddr.toOptions();
      this.address = `${mOptions.transport}://${mOptions.host}:${mOptions.port}`;
      this.id = multiaddr.getPeerId();
      this.publicKey = hashUils.getHexFromIpfsHash(multiaddr.getPeerId());
    } catch (e) {
      this.address = options.address;
      this.id = hashUils.getIpfsHashFromHex(this.publicKey);
    }



    this.state = options.state || states.FOLLOWER;    // Our current state.
    this.leader = '';                               // Leader in our cluster.
    this.term = 0;                                  // Our current term.

    this._initialize(options);
  }

  _initialize (options) {
    let raft = this;

    raft.on('term change', function change () {
      raft.votes.for = null;
      raft.votes.granted = 0;
    });

    raft.on('state change', function change (state) {
      raft.timers.clear('heartbeat, election');
      raft.heartbeat(states.LEADER === raft.state ? raft.beat : raft.timeout());
      raft.emit(Object.keys(states)[state].toLowerCase());
    });


    raft.on('data', async (packet, write = () => {
    }) => {
      let reason;

      if (!_.isObject(packet)) {
        reason = 'Invalid packet received';
        raft.emit('error', new Error(reason));
        return write(await raft.actions.message.packet('error', reason));
      }


      if (packet.term > raft.term) {
        raft.change({
          leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || raft.leader,
          state: states.FOLLOWER,
          term: packet.term
        });
      } else if (packet.term < raft.term) {
        reason = 'Stale term detected, received `' + packet.term + '` we are at ' + raft.term;
        raft.emit('error', new Error(reason));

        return write(raft.actions.message.packet('error', reason));
      }

      if (states.LEADER === packet.state) {
        if (states.FOLLOWER !== raft.state)
          raft.change({state: states.FOLLOWER});

        if (packet.publicKey !== raft.leader)
          raft.change({leader: packet.publicKey});

        raft.heartbeat(raft.timeout());
      }

      if (packet.type === 'vote') {
        if (raft.votes.for && raft.votes.for !== packet.publicKey) {
          raft.emit('vote', packet, false);
          return write(await raft.actions.message.packet('voted', {granted: false}));
        }

        if (raft.log) {
          const {index, term} = await raft.log.getLastInfo();

          if (index > packet.last.index && term > packet.last.term) {
            raft.emit('vote', packet, false);
            return write(await raft.actions.message.packet('voted', {granted: false}));
          }
        }

        raft.votes.for = packet.publicKey;
        raft.emit('vote', packet, true);
        raft.change({leader: packet.publicKey, term: packet.term});
        write(await raft.actions.message.packet('voted', {granted: true}));
        raft.heartbeat(raft.timeout());
        return;
      }

      if (packet.type === 'voted') {
        if (states.CANDIDATE !== raft.state) {
          return write(await raft.actions.message.packet('error', 'No longer a candidate, ignoring vote'));
        }

        if (packet.data.granted) {
          raft.votes.granted++;
        }

        if (raft.quorum(raft.votes.granted)) {
          raft.change({leader: raft.publicKey, state: states.LEADER});
          raft.actions.message.message(states.FOLLOWER, await raft.actions.message.packet('append'));
        }
        write();
        return;
      }

      if (packet.type === 'error') {
        raft.emit('error', new Error(packet.data));
        return;
      }

      if (packet.type === 'append') {
        const {index} = await raft.log.getLastInfo();

        if (packet.last.index !== index && packet.last.index !== 0) {
          const hasIndex = await raft.log.has(packet.last.index);

          if (!hasIndex)
            return raft.actions.message.message(states.LEADER, await raft.actions.message.packet('append fail', {
              term: packet.last.term,
              index: packet.last.index
            }));

          /*     if (hasIndex) raft.log.removeEntriesAfter(packet.last.index); //todo think about stage rules
               else return raft.actions.message.message(states.LEADER, await raft.actions.message.packet('append fail', {
                 term: packet.last.term,
                 index: packet.last.index
               }));*/
        }

        if (packet.data) {
          const entry = packet.data[0];
          await raft.log.saveCommand(entry.command, entry.term, entry.index);

          raft.actions.message.message(states.LEADER, await raft.actions.message.packet('append ack', {
            term: entry.term,
            index: entry.index
          }));
        }

        if (raft.log.committedIndex < packet.last.committedIndex) {
          const entries = await raft.log.getUncommittedEntriesUpToIndex(packet.last.committedIndex, packet.last.term);
          await raft.commitEntries(entries);
        }

        return;
      }

      if (packet.type === 'append ack') {
        const entry = await raft.log.commandAck(packet.data.index, packet.publicKey);
        if (raft.quorum(entry.responses.length) && !entry.committed) {
          const entries = await raft.log.getUncommittedEntriesUpToIndex(entry.index, entry.term);
          raft.commitEntries(entries);
        }

        this.emit('append_ack', entry.index);
        return;
      }

      if (packet.type === 'append fail') {
        const previousEntry = await raft.log.get(packet.data.index);
        const append = await raft.actions.message.appendPacket(previousEntry);
        write(append);
        return;
      }


      if (packet.type === 'task_vote') {
        this.actions.tasks.vote(packet.data.taskId, packet.data.share, packet.publicKey, packet.term);
        return;
      }

      if (packet.type === 'task_voted') {
        this.actions.tasks.voted(packet.data.taskId, packet.data.payload, packet.publicKey);
        this.emit('task_voted', packet.data.taskId);
        return;
      }


      if (packet.type === 'task_executed') {
        this.actions.tasks.executed(packet.data.taskId, packet.data.payload, packet.publicKey);
        return;
      }


      if (raft.listeners('rpc').length) {
        raft.emit('rpc', packet, write);
      } else {
        write(await raft.actions.message.packet('error', 'Unknown message type: ' + packet.type));
      }


    });


    if (states.CHILD === raft.state)
      return raft.emit('initialize');

    if (_.isFunction(raft.Log)) {
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

    if (_.isFunction(raft.initialize)) {
      if (raft.initialize.length === 2)
        return raft.initialize(options, initialize);
      raft.initialize(options);
    }

    initialize();
  }

  quorum (responses) {
    if (!this.nodes.length || !responses) return false;

    return responses >= this.majority();
  }

  majority () {
    return Math.ceil(this.nodes.length / 2) + 1;
  }

  heartbeat (duration) {
    let raft = this;

    duration = duration || raft.beat;

    if (raft.timers.active('heartbeat')) {
      raft.timers.adjust('heartbeat', duration);

      return raft;
    }

    raft.timers.setTimeout('heartbeat', async () => {
      if (states.LEADER !== raft.state) {
        raft.emit('heartbeat timeout');

        return raft.actions.node.promote();
      }

      //
      // According to the raft spec we should be sending empty append requests as
      // heartbeat. We want to emit an event so people can modify or inspect the
      // payload before we send it. It's also a good indication for when the
      // idle state of a LEADER as it didn't get any messages to append/commit to
      // the FOLLOWER'S.
      //
      let packet = await raft.actions.message.packet('append');

      raft.emit('heartbeat', packet);
      raft.actions.message.message(states.FOLLOWER, packet).heartbeat(raft.beat);
    }, duration);

    return raft;
  }

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


module.exports = Raft;
