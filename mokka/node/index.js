const TimerController = require('./controllers/timerController'),
  GossipController = require('./controllers/gossipController'),
  _ = require('lodash'),
  Log = require('../log/log'),
  NodeModel = require('./models/nodeModel'),
  states = require('./factories/stateFactory'),
  decodePacketUtils = require('../utils/decodePacket'),
  messageTypes = require('./factories/messageTypesFactory'),
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

class Mokka extends NodeModel {
  constructor (options = {}) {
    super(options);

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
    // this.removeSynced = options.removeSynced || false;


    this.gossipOptions = {
      heartbeat: options.gossipHeartbeat || 1000,
      timeout: options.gossipTimeout || 1000
    };

    this.votes = {
      for: null,
      granted: 0,
      shares: [],
      secret: null,
      started: null,
      priority: 1
    };

    this.Log = options.Log || Log;
    this.logger = bunyan.createLogger({name: 'mokka.logger', level: options.logLevel || 3});

    this.change = change;
    this.networkSecret = options.networkSecret || '1234567';
    this.log = null;
    this.lastInfo = null;

    this.cache = new NodeCache();
    this.processor = new TaskProcessor(this);
    this.time = new TimerController(this);
    this.gossip = new GossipController(this);

    this.requestProcessor = new RequestProcessor(this);
    this.gossipRequestProcessor = new GossipRequestProcessor(this);


    this.log = new this.Log(this, options.logOptions);

    this._registerEvents();
    this._initialize(options);
  }


  _registerEvents () {
    this.on('term change', function change () {
      this.logger.trace('clear vote by term change');
      this.votes.for = null;
      this.votes.granted = 0;
      this.votes.shares = [];
      this.votes.secret = null;
      this.votes.started = null;
    });

    this.on('state change', function change (state) {
      //this.logger.trace(`state changed: ${_.invert(states)[state]}`);
      this.logger.info(`state changed: ${_.invert(states)[state]}`); //todo remove
      this.time.heartbeat(this.beat);
      this.emit(Object.keys(states)[state].toLowerCase());
    });

    this.on('data', async packet => {

      packet = decodePacketUtils(packet);

      if ([messageTypes.GOSSIP_SECOND_RESPONSE, messageTypes.GOSSIP_FIRST_RESPONSE, messageTypes.GOSSIP_REQUEST].includes(packet.type))
        return await this.gossipRequestProcessor.process(packet);

      await this.requestProcessor.process(packet);
    });


    this.log.on(this.log.eventTypes.LOGS_UPDATED, async () => {
      this.lastInfo = await this.log.entry.getLastInfo();
    });
  }


  async _initialize (options) {

    this.lastInfo = await this.log.entry.getLastInfo();

    if (!_.isFunction(this.initialize))
      throw Error('the initialize function needs to be declared!');


    this.initialize(options);
    this.emit('initialize');

    this.gossip.start();
    this.processor._runLoop();

    this.time.heartbeat(_.random(0, this.election.max));
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
