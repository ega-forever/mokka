const EventEmitter = require('events'),
  TimerController = require('./controllers/timerController'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  Multiaddr = require('multiaddr'),
  messageTypes = require('./factories/messageTypesFactory'),
  hashUtils = require('../utils/hashes'),
  decodePacketUtils = require('../utils/decodePacket'),
  NodeCache = require('ttl-mem-cache'),
  VoteActions = require('./actions/voteActions'),
  NodeActions = require('./actions/nodeActions'),
  semaphore = require('semaphore')(1),
  AppendActions = require('./actions/appendActions'),
  MessageActions = require('./actions/messageActions'),
  RequestProcessor = require('./services/requestProcessorService'),
  GossipRequestProcessor = require('./services/gossipRequestProcessorService'),
  bunyan = require('bunyan'),
  TaskProcessor = require('./api/taskProcessor');

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
   // this.timers = new Tick(this); //todo move to timecontroller
    this.Log = options.Log;

    this.time = new TimerController(this);

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

    mokka.on('data', async (packet) => { //todo implement decoding and encoding for data

      packet = decodePacketUtils(packet);

      let data = packet.type === messageTypes.ACK ?
        await this.requestProcessor.process(packet) :
        await new Promise(res => {
          semaphore.take(async () => {
            let data = await this.requestProcessor.process(packet);
            res(data);
            semaphore.leave();
          });
        });


      if (!_.has(data, 'who') && !_.has(data, '0.who'))
        return;

      if (_.isArray(data)) {

        for (let item of data)
          this.actions.message.message(item.who, item.reply);

        return;
      }

      this.actions.message.message(data.who, data.reply);
    });


    if (states.CHILD === mokka.state)
      return mokka.emit('initialize');


    if (_.isFunction(mokka.Log))
      mokka.log = new mokka.Log(mokka, options.log_options);

    mokka.lastInfo = await this.log.getLastInfo();

    mokka.log.on(mokka.log.eventTypes.LOGS_UPDATED, async ()=>{
      mokka.lastInfo = await this.log.getLastInfo();
    });

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
