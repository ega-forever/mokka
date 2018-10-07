const EventEmitter = require('eventemitter3'),
  Tick = require('tick-tock'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  TaskActions = require('./actions/taskActions'),
  Multiaddr = require('multiaddr'),
  messageTypes = require('./factories/messageTypesFactory'),
  hashUils = require('./utils/hashes'),
  Web3 = require('web3'),
  web3 = new Web3(),
  secrets = require('secrets.js-grempe'),
  EthUtil = require('ethereumjs-util'),
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
      for: null,
      granted: 0,
      shares: [],
      secret: null
    };

    this.orhpanVotes = {
      for: null,
      positive: 0,
      negative: 0
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
      raft.votes.shares = [];
      raft.votes.secret = null;
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

      if (packet.type === messageTypes.ORPHAN_VOTE) {
        /*        if (raft.orhpanVotes.for && raft.orhpanVotes.for !== packet.publicKey) { //may be remove
                  raft.emit(messageTypes.ORPHAN_VOTE, packet, false);
                  let reply = await raft.actions.message.packet(messageTypes.ORPHAN_VOTED, {granted: false});
                  return write(reply);
                }*/

        let hasLog = await raft.log.has(packet.data.index);

        if (!hasLog) {
          let reply = await raft.actions.message.packet(messageTypes.ORPHAN_VOTED, {
            provided: packet.data.hash,
            accepted: null
          });
          return write(reply);
        }


        let {hash: currentHash} = await this.log.get(packet.data.index);
        let reply = await raft.actions.message.packet(messageTypes.ORPHAN_VOTED, {
          provided: packet.data.hash,
          accepted: currentHash
        });
        return write(reply);
      }

      if (packet.type === messageTypes.ORPHAN_VOTED) {

        if (raft.orhpanVotes.for !== packet.data.provided) {
          return;
        }

        if (raft.orhpanVotes.for === packet.data.accepted)
          raft.orhpanVotes.positive++;


        if (raft.orhpanVotes.for !== packet.data.accepted)
          raft.orhpanVotes.negative++;


        if (raft.orhpanVotes.negative + raft.orhpanVotes.positive < this.majority())
          return;

        if (raft.orhpanVotes.negative >= raft.orhpanVotes.positive) {//todo rollback
          console.log('reset node state');

          await this.log.removeEntriesAfter(0);
          this.log.committedIndex = 0;
          return;
        }

        if (raft.orhpanVotes.positive >= raft.orhpanVotes.negative) {
          raft.orhpanVotes = {
            for: null,
            negative: 0,
            positive: 0
          }
        }

      }

      if (packet.type === messageTypes.VOTE) { //add rule - don't vote for node, until this node receive the right history (full history)

        if (!packet.data.share) {
          raft.emit(messageTypes.VOTE, packet, false);
          return write(await raft.actions.message.packet(messageTypes.VOTED, {granted: false}));
        }


        const signedShare = web3.eth.accounts.sign(packet.data.share, `0x${this.privateKey}`);

        if (raft.votes.for && raft.votes.for !== packet.publicKey) {
          raft.emit(messageTypes.VOTE, packet, false);
          return write(await raft.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare}));
        }


        const {index, term, hash} = await raft.log.getLastInfo();

        if ((index > packet.last.index && term > packet.last.term) || packet.last.hash !== hash || packet.last.committedIndex < raft.log.committedIndex) {
          //if (index > packet.last.index && term > packet.last.term) {
          raft.emit(messageTypes.VOTE, packet, false);
          return write(await raft.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare}));
        }


        raft.votes.for = packet.publicKey;
        raft.emit(messageTypes.VOTE, packet, true);
        raft.change({leader: packet.publicKey, term: packet.term});
        let reply = await raft.actions.message.packet(messageTypes.VOTED, {granted: true, signed: signedShare});
        write(reply);
        raft.heartbeat(raft.timeout());
        return;
      }

      if (packet.type === messageTypes.VOTED) {
        if (states.CANDIDATE !== raft.state) {
          return write(await raft.actions.message.packet(states.ERROR, 'No longer a candidate, ignoring vote'));
        }

        if (!packet.data.signed)
          return write(await raft.actions.message.packet(states.ERROR, 'the vote hasn\'t been singed, ignoring vote'));

        const restoredPublicKey = EthUtil.ecrecover(
          Buffer.from(packet.data.signed.messageHash.replace('0x', ''), 'hex'),
          parseInt(packet.data.signed.v),
          Buffer.from(packet.data.signed.r.replace('0x', ''), 'hex'),
          Buffer.from(packet.data.signed.s.replace('0x', ''), 'hex')).toString('hex');

        let localShare = _.find(this.votes.shares, {
          publicKey: restoredPublicKey,
          share: packet.data.signed.message,
          voted: false
        });

        if (!localShare)
          return write(await raft.actions.message.packet(states.ERROR, 'wrong share for vote provided!'));

        localShare.voted = true;


        if (packet.data.granted)
          raft.votes.granted++;

        if (raft.quorum(raft.votes.granted)) {

          let validatedShares = this.votes.shares.map(share => share.share);

          let comb = secrets.combine(validatedShares);

          if (comb !== this.votes.secret) {
            this.votes = {
              for: null,
              granted: 0,
              shares: [],
              secret: null
            };

            return;
          }

          raft.change({leader: raft.publicKey, state: states.LEADER});
          raft.actions.message.message(states.FOLLOWER, await raft.actions.message.packet('append'));
        }
        write();
        return;
      }

      if (packet.type === messageTypes.ERROR) {
        raft.emit('error', new Error(packet.data));
        return;
      }

      if (packet.type === messageTypes.APPEND) {
        const {index, hash} = await raft.log.getLastInfo();

        if (packet.last.hash !== hash && packet.last.index === index) {//todo make rule for controlling alter-history (orphaned blocks)
//          console.log('branch forking has been found!', hash, packet.last.hash);

          raft.orhpanVotes.for = hash;

          let reply = await raft.actions.message.packet(messageTypes.ORPHAN_VOTE, {hash: hash});

          await raft.actions.message.message(states.CANDIDATE, reply);
          await raft.actions.message.message(states.CHILD, reply);
          return;
          // await this.log.removeEntriesAfterLastCheckpoint(this.publicKey, packet.last.publicKey); //vote for orphan
        }

        if (packet.last.index !== index && packet.last.index !== 0) {
          const hasIndex = await raft.log.has(packet.last.index);


          if (!hasIndex) {
            let {index: lastIndex} = await this.log.getLastInfo(); //todo validate
            return raft.actions.message.message(states.LEADER, await raft.actions.message.packet(messageTypes.APPEND_FAIL, {
              index: lastIndex + 1
            }));
          }

          /*       let {hash} = await raft.log.get(packet.last.index); //todo validate

                 if (hash !== packet.last.hash)
                   return raft.actions.message.message(states.LEADER, await raft.actions.message.packet(messageTypes.APPEND_FAIL, {
                     term: packet.last.term,
                     index: packet.last.index
                   }));*/

          /*    if (hasIndex) //won't ever meet this
                return await raft.log.removeEntriesAfter(packet.last.index); //todo think about stage rules
    */
          /*return raft.actions.message.message(states.LEADER, await raft.actions.message.packet(messageTypes.APPEND_FAIL, {
            term: packet.last.term,
            index: packet.last.index,
            hash: packet.last.hash
          }));*/
        }

        if (packet.data) {
          const entry = packet.data[0]; //todo make validation of appended packet (can't rewrite chain)
          //await raft.log.saveCommand(entry.command, entry.term, entry.index, entry.hash);

          try {
            await raft.log.saveCommand(entry.command, entry.term, entry.index, entry.hash);
          } catch (e) {
            let {index: lastIndex} = await raft.log.getLastInfo();
            return raft.actions.message.message(states.LEADER, await raft.actions.message.packet(messageTypes.APPEND_FAIL, {//can't get your entry, give me next to mine index!
              index: lastIndex + 1
            }));
          }


          raft.actions.message.message(states.LEADER, await raft.actions.message.packet(messageTypes.APPEND_ACK, {
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

      if (packet.type === messageTypes.APPEND_ACK) {
        const entry = await raft.log.commandAck(packet.data.index, packet.publicKey);
        if (raft.quorum(entry.responses.length) && !entry.committed) {
          const entries = await raft.log.getUncommittedEntriesUpToIndex(entry.index, entry.term);
          await raft.commitEntries(entries);
        }

        this.emit('append_ack', entry.index);
        return;
      }

      if (packet.type === messageTypes.APPEND_FAIL) {
        let previousEntry = await raft.log.get(packet.data.index);

        if (!previousEntry) {
          previousEntry = await raft.log.getLastEntry();

          /*     let {index: lastIndex} = await this.log.getLastInfo();

               console.log('no entry', packet.data.index, lastIndex)
               process.exit(0)*/
        }

        const append = await raft.actions.message.appendPacket(previousEntry);
        write(append);
        return;
      }


      /*      if (packet.type === messageTypes.TASK_VOTE) {
              this.actions.tasks.vote(packet.data.taskId, packet.data.share, packet.publicKey, packet.term);
              return;
            }

            if (packet.type === messageTypes.TASK_VOTED) {
              this.actions.tasks.voted(packet.data.taskId, packet.data.payload, packet.publicKey);
              this.emit('task_voted', packet.data.taskId);
              return;
            }


            if (packet.type === messageTypes.TASK_EXECUTED) {
              this.actions.tasks.executed(packet.data.taskId, packet.data.payload, packet.publicKey);
              return;
            }*/


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
      if (err) return raft.emit(messageTypes.ERROR, err);

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
      let packet = await raft.actions.message.packet(messageTypes.APPEND);

      raft.emit(messageTypes.HEARTBEAT, packet);
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
      this.emit(messageTypes.COMMIT, entry.command);
    });
  }
}


module.exports = Raft;
