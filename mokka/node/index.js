const EventEmitter = require('events'),
  TimerController = require('./controllers/timerController'),
  GossipController = require('./controllers/gossipController'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  Multiaddr = require('multiaddr'),
  decodePacketUtils = require('../utils/decodePacket'),
  messageTypes = require('./factories/messageTypesFactory'),
  hashUtils = require('../utils/hashes'),
  NodeCache = require('ttl-mem-cache'),
  VoteActions = require('./actions/voteActions'),
  NodeActions = require('./actions/nodeActions'),
  AppendActions = require('./actions/appendActions'),
  MessageActions = require('./actions/messageActions'),
  GossipActions = require('./actions/gossipActions'),
  RequestProcessor = require('./services/requestProcessorService'),
  GossipRequestProcessor = require('./services/gossipRequestProcessorService'),
  bunyan = require('bunyan'),
  TaskProcessor = require('./api/taskProcessor');

const change = require('modification')(' change');

class Mokka extends EventEmitter {
  constructor (options = {}) {
    super();

    this.actions = {
      append: new AppendActions(this),
      vote: new VoteActions(this),
      node: new NodeActions(this),
      message: new MessageActions(this),
      gossip: new GossipActions(this)
    };

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
    this.Log = options.Log;

    this.logger = bunyan.createLogger({name: 'mokka.logger', level: options.logLevel || 3});

    this.change = change;
    this.networkSecret = options.networkSecret || '1234567';
    //this.latency = 0;//todo implement
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
      this.publicKey = hashUtils.getHexFromIpfsHash(multiaddr.getPeerId());
    } catch (e) {
      this.address = options.address;
      this.id = hashUtils.getIpfsHashFromHex(this.publicKey);
    }


    this.state = options.state || states.FOLLOWER;    // Our current state.
    this.leader = '';                               // Leader in our cluster.
    this.term = 0;                                  // Our current term.


    this.time = new TimerController(this);
    this.gossip = new GossipController(this);

    this.requestProcessor = new RequestProcessor(this);
    this.gossipRequestProcessor = new GossipRequestProcessor(this);

    this.lastInfo = null;

    this._initialize(options);
  }

  async _initialize (options) {
    let mokka = this;

    //todo add listener for info change


    mokka.on('term change', function change () {
      mokka.logger.trace('clear vote by term change');
      mokka.votes.for = null;
      mokka.votes.granted = 0;
      mokka.votes.shares = [];
      mokka.votes.secret = null;
      mokka.votes.started = null;
    });

    mokka.on('state change', function change (state) {
      mokka.logger.trace(`state changed: ${_.invert(states)[state]}`);
      mokka.logger.info(`state changed: ${_.invert(states)[state]}`); //todo remove
      mokka.time.heartbeat(mokka.beat);
      mokka.emit(Object.keys(states)[state].toLowerCase());
    });

    mokka.on('data', async packet => {

      packet = decodePacketUtils(packet);

      if([messageTypes.GOSSIP_SECOND_RESPONSE, messageTypes.GOSSIP_FIRST_RESPONSE, messageTypes.GOSSIP_REQUEST].includes(packet.type))
        return await this.gossipRequestProcessor.process(packet);

      await this.requestProcessor.process(packet);

    });


    if (states.CHILD === mokka.state)
      return mokka.emit('initialize');


    if (_.isFunction(mokka.Log))
      mokka.log = new mokka.Log(mokka, options.log_options);

    mokka.lastInfo = await this.log.getLastInfo();

    mokka.log.on(mokka.log.eventTypes.LOGS_UPDATED, async ()=>{
      mokka.lastInfo = await this.log.getLastInfo();
    });

    mokka.gossip.start();
    mokka.processor._runLoop();



    function initialize (err) {
      if (err) return mokka.emit(messageTypes.ERROR, err);

      mokka.emit('initialize');
      mokka.time.heartbeat(_.random(0, mokka.election.max));
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

}


module.exports = Mokka;
