const EventEmitter = require('events'),
  Tick = require('tick-tock'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  Multiaddr = require('multiaddr'),
  messageTypes = require('./factories/messageTypesFactory'),
  hashUils = require('../utils/hashes'),
  VoteActions = require('./actions/voteActions'),
  validateSecretUtil = require('../utils/validateSecret'),
  NodeActions = require('./actions/nodeActions'),
  AppendActions = require('./actions/appendActions'),
  MessageActions = require('./actions/messageActions'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node'}),
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
      secret: null,
      started: null,
      priority: 1
    };

    //this.write = this.write || options.write || null;
    this.threshold = options.threshold || 0.8;
    this.timers = new Tick(this);
    this.Log = options.Log;
    this.change = change;
    this.networkSecret = options.networkSecret || '1234567';
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
    let mokka = this;

    mokka.on('term change', function change () {
      log.info('clear vote by term change');
      mokka.votes.for = null;
      mokka.votes.granted = 0;
      mokka.votes.shares = [];
      mokka.votes.secret = null;
      mokka.votes.started = null;
    });

    mokka.on('state change', function change (state) {
      log.info(`state changed[${this.index}]: ${_.invert(states)[state]}`);
      //mokka.heartbeat(states.LEADER === mokka.state ? mokka.beat : mokka.timeout());
      mokka.heartbeat(mokka.beat);
      mokka.emit(Object.keys(states)[state].toLowerCase());
    });

    this.on('threshold', async () => {
      if (this.state === states.LEADER) {
        log.info('restarting vote by threshold');
        this.change({state: states.FOLLOWER, leader: ''});
        this.timers.clear('heartbeat');
        await Promise.delay(this.window());
        mokka.actions.node.promote();
      }
    });

    mokka.on('data', async (packet, write = () => {
    }) => {


      log.info(`[${Date.now()}]incoming packet type: ${packet.type}`);

      let reply;

      if (!_.isObject(packet)) {
        let reason = 'Invalid packet received';
        mokka.emit(messageTypes.ERROR, new Error(reason));
        let reply = await mokka.actions.message.packet(messageTypes.ERROR, reason);
        return write(reply);
      }

      if (states.LEADER === packet.state && packet.type === messageTypes.APPEND) {


        if(!_.has(packet, 'proof.index') && !_.has(packet, 'proof.shares')){
          log.info('proof is not provided!');
          let reply = await mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
          return write(reply);
        }


        let pubKeys = this.nodes.map(node => node.publicKey);
        pubKeys.push(this.publicKey);

        if(packet.proof.index && _.has(packet, 'proof.shares')){

          let proofEntry = await this.log.get(packet.proof.index);

          let validated = validateSecretUtil(
            this.networkSecret,
            this.election.max,
            pubKeys,
            packet.proof.secret,
            _.get(proofEntry, 'createdAt', Date.now()),
            packet.proof.shares);

          if(!validated){
            log.error('the initial proof validation failed');
            let reply = await mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
            return write(reply);
          }

          await this.log.addProof(packet.term, packet.proof)
        }


        if(packet.proof.index && !_.has(packet, 'proof.shares')){

          let proofEntryShare = await this.log.getProof(packet.term);

          if(!proofEntryShare){
         // if(!proofEntryShare || proofEntryShare.hash !== packet.proof.hash){
            log.error('the secondary proof validation failed');
            let reply = await mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
            return write(reply);
          }
        }

        mokka.change({
          leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || mokka.leader,
          state: states.FOLLOWER,
          term: packet.term
        });

      }

      // if (packet.type !== messageTypes.VOTED) {
     // mokka.heartbeat(states.LEADER === mokka.state ? mokka.beat : mokka.timeout());
      log.info('append heartbeat from master');
      mokka.heartbeat(states.LEADER === mokka.state ? mokka.beat : mokka.timeout());
      // }

      if (packet.type === messageTypes.VOTE) { //add rule - don't vote for node, until this node receive the right history (full history)
        await this.actions.vote.vote(packet, write);
      }

      if (packet.type === messageTypes.VOTED) {
        return await this.actions.vote.voted(packet, write);
      }

      if (packet.type === messageTypes.ERROR) {
        mokka.emit(messageTypes.ERROR, new Error(packet.data));
      }


      if (packet.type === messageTypes.APPEND) {
        return await this.actions.append.append(packet, write); //move write
      }

      if (packet.type === messageTypes.APPEND_ACK) {
        await this.actions.append.appendAck(packet);
      }

      if (packet.type === messageTypes.APPEND_FAIL) {
        return await this.actions.append.appendFail(packet, write);
      }

      if (mokka.listeners('rpc').length) {
        mokka.emit('rpc', packet, write);
      } else {
        let reply = await mokka.actions.message.packet('error', 'Unknown message type: ' + packet.type);
      }

      if (!reply)
        reply = await mokka.actions.message.packet(messageTypes.ACK);

      write(reply);

    });


    if (states.CHILD === mokka.state)
      return mokka.emit('initialize');

    if (_.isFunction(mokka.Log)) {
      mokka.log = new mokka.Log(mokka, options);
    }


    function initialize (err) {
      if (err) return mokka.emit(messageTypes.ERROR, err);

      mokka.emit('initialize');
      // mokka.heartbeat(mokka.timeout());
      mokka.heartbeat(_.random(0, mokka.election.max));
    }

    if (_.isFunction(mokka.initialize)) {
      if (mokka.initialize.length === 2)
        return mokka.initialize(options, initialize);
      mokka.initialize(options);
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
    let mokka = this;

    duration = duration || mokka.beat;

    if (mokka.timers.active('heartbeat')) {
      mokka.timers.adjust('heartbeat', duration);

      return mokka;
    }

    mokka.timers.setTimeout('heartbeat', async () => {

      //    return; //todo disabled heartbeat


      if (states.LEADER !== mokka.state) {
        mokka.emit('heartbeat timeout');

        log.info('promoting by timeout');
        return mokka.actions.node.promote();
      }


      let packet = await mokka.actions.message.packet(messageTypes.ACK);

      log.info('send append request by timeout');
      mokka.emit(messageTypes.ACK, packet);
      await mokka.actions.message.message(states.FOLLOWER, packet, {ensure: false, timeout: this.election.max});
      mokka.heartbeat(mokka.beat);
    }, duration);

    return mokka;
  }

  /**
   * Generate the various of timeouts.
   *
   * @returns {Number}
   * @private
   */
  timeout () {
    return _.random(this.beat, parseInt(this.beat * 1.5));
  }

  window () {
    return Math.floor(Math.random() * (this.election.max - this.election.min + 1) + this.election.min);
  }

  /**
   * Create a clone of the current instance with the same configuration. Ideally
   * for creating connected nodes in a cluster.. And let that be something we're
   * planning on doing.
   *
   * @param {Object} options Configuration that should override the default config.
   * @returns {mokka} The newly created instance.
   * @public
   */
  clone (options) { //todo replace with lodash
    options = options || {};

    let mokka = this,
      node = {
        Log: mokka.Log,
        election_max: mokka.election.max,
        election_min: mokka.election.min,
        heartbeat: mokka.beat,
        threshold: mokka.threshold
      }, key;

    for (key in node) {
      if (key in options || !node.hasOwnProperty(key)) continue;

      options[key] = node[key];
    }

    return new mokka.constructor(options);
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
