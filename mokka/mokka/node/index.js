const EventEmitter = require('eventemitter3'),
  Tick = require('tick-tock'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  Multiaddr = require('multiaddr'),
  messageTypes = require('./factories/messageTypesFactory'),
  eventTypes = require('./factories/eventFactory'),
  hashUils = require('../utils/hashes'),
  VoteActions = require('./actions/voteActions'),
  NodeActions = require('./actions/nodeActions'),
  AppendActions = require('./actions/appendActions'),
  MessageActions = require('./actions/messageActions'),
  Api = require('./api');

const change = require('modification')(' change');

class Mokka extends EventEmitter {
  constructor (options = {}) {
    super();

    AppendActions(this);
    VoteActions(this);
    NodeActions(this);
    MessageActions(this);
    Api(this);

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

    //this.write = this.write || options.write || null;
    this.threshold = options.threshold || 0.8;
    this.timers = new Tick(this);
    this.Log = options.Log;
    this.change = change;
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

      //  let reply = await raft.actions.message.packet(messageTypes.ACK);
      let reply;

      if (!_.isObject(packet)) {
        let reason = 'Invalid packet received';
        raft.emit(messageTypes.ERROR, new Error(reason));
        let reply = await raft.actions.message.packet(messageTypes.ERROR, reason);
        return write(reply);
      }

      if (packet.term > raft.term) {

        raft.change({
          leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || raft.leader,
          state: states.FOLLOWER,
          term: packet.term
        });
      } else if (packet.term < raft.term) {
        let reason = 'Stale term detected, received `' + packet.term + '` we are at ' + raft.term;
        raft.emit('error', new Error(reason));

        let reply = await raft.actions.message.packet(messageTypes.ERROR, reason);
        return write(reply);
      }

      if (states.LEADER === packet.state) {
        if (states.FOLLOWER !== raft.state)
          raft.change({state: states.FOLLOWER});

        if (packet.publicKey !== raft.leader)
          raft.change({leader: packet.publicKey});

        raft.heartbeat(raft.timeout());
      }


      if (packet.type === messageTypes.STATE) {
        reply = await this.actions.node.state();
      }

      if (packet.type === messageTypes.STATE_RECEIVED) {
        this.actions.node.stateReceived(packet);
      }

      if (packet.type === messageTypes.ORPHAN_VOTE) {
        reply = await this.actions.vote.orphanVote(packet);
      }

      if (packet.type === messageTypes.ORPHAN_VOTED) {
        reply = await this.actions.vote.orphanVoted(packet);
      }

      if (packet.type === messageTypes.VOTE) { //add rule - don't vote for node, until this node receive the right history (full history)
        reply = await this.actions.vote.vote(packet);
      }

      if (packet.type === messageTypes.VOTED) {
        let reply = await this.actions.vote.voted(packet);
      }

      if (packet.type === messageTypes.ERROR) {
        raft.emit(messageTypes.ERROR, new Error(packet.data));
      }


      if (packet.type === messageTypes.APPEND) {
        await this.actions.append.append(packet);
      }

      if (packet.type === messageTypes.APPEND_ACK) {
        await this.actions.append.appendAck(packet);
      }

      if (packet.type === messageTypes.APPEND_FAIL) {
        let reply = await this.actions.append.appendFail(packet, write);
      }

      if (raft.listeners('rpc').length) {
        raft.emit('rpc', packet, write);
      } else {
        let reply = await raft.actions.message.packet('error', 'Unknown message type: ' + packet.type);
      }


      if (!reply)
        reply = await raft.actions.message.packet(messageTypes.ACK);

      write(reply);

    });


    if (states.CHILD === raft.state)
      return raft.emit('initialize');

    if (_.isFunction(raft.Log)) {
      raft.log = new raft.Log(raft, options);
    }


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


      let packet = await raft.actions.message.packet(messageTypes.APPEND);

      raft.emit(messageTypes.HEARTBEAT, packet);
      await raft.actions.message.message(states.FOLLOWER, packet);
      raft.heartbeat(raft.beat);
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


module.exports = Mokka;
