const EventEmitter = require('events'),
  Tick = require('tick-tock'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  Multiaddr = require('multiaddr'),
  messageTypes = require('./factories/messageTypesFactory'),
  hashUils = require('../utils/hashes'),
  //NodeCache = require('node-cache'),
  NodeCache = require('ttl-mem-cache'),
  VoteActions = require('./actions/voteActions'),
  NodeActions = require('./actions/nodeActions'),
  semaphore = require('semaphore')(1),
  AppendActions = require('./actions/appendActions'),
  MessageActions = require('./actions/messageActions'),
  RequestProcessor = require('./services/requestProcessorService'),
  bunyan = require('bunyan'),
  TaskProcessor = require('./api/taskProcessor'),
  log = bunyan.createLogger({name: 'node'});

const change = require('modification')(' change');

class Mokka extends EventEmitter {
  constructor (options = {}) {
    super();

    AppendActions(this);
    VoteActions(this);
    NodeActions(this);
    MessageActions(this);

    this.election = {
      min: options.electionMin || 150,
      max: options.electionMax || 300
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

    this.threshold = options.threshold || 0.8;
    this.timers = new Tick(this);
    this.Log = options.Log;
    this.change = change;
    this.networkSecret = options.networkSecret || '1234567';
    this.latency = 0;
    this.voteTimeoutRandomFactor = options.voteTimeoutRandomFactor || 10;
    this.log = null;
    this.nodes = [];
    this.cache = new NodeCache();
    this.processor = new TaskProcessor(this);
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
    this.requestProcessor = new RequestProcessor(this);

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
      log.info(`state changed: ${_.invert(states)[state]}`);
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

    mokka.on('data', async (packet, write) => {

      semaphore.take(async () => {

        let data = await this.requestProcessor.process(packet);

        if (!_.has(data, 'who') && !_.has(data, '0.who'))
          return semaphore.leave();

        if (_.isArray(data)) {

          for (let item of data)
            item.who === packet.publicKey && write ?
              write(item.reply) :
              this.actions.message.message(item.who, item.reply);


          return semaphore.leave();
        }


        if (data.who === packet.publicKey && write) {
          write(data.reply);
          return semaphore.leave();
        }

        this.actions.message.message(data.who, data.reply);
        semaphore.leave();
      });


    });


    if (states.CHILD === mokka.state)
      return mokka.emit('initialize');


    if (_.isFunction(mokka.Log))
      mokka.log = new mokka.Log(mokka, options.log_options);


    function initialize (err) {
      if (err) return mokka.emit(messageTypes.ERROR, err);

      mokka.emit('initialize');
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
        electionMax: mokka.election.max,
        electionMin: mokka.election.min,
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
    for(let entry of entries)
      await this.log.commit(entry.index);
  }
}


module.exports = Mokka;
