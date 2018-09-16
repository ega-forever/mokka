const eventEmitter = require('events'),
  uniqid = require('uniqid'),
  msg = require('axon'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'app.services.clientService'}),
  _ = require('lodash');

class ClientService extends eventEmitter {

  constructor(address, options) {
    super();


    this.address = address;
    this.socket = msg.socket('rep');
    this.socket.bind(this.address);

    this.election = {
      min: _.get(options, 'election.min', 150),
      max: _.get(options, 'election.min', 300)
    };

    this.heartbeat = _.get(options, 'heartbeat', 50);

    this.votes = {
      for: null,                // Who did we vote for in this current term.
      granted: 0                // How many votes we're granted to us.
    };

    /*   raft.write = raft.write || options.write || null;
       raft.threshold = options.threshold || 0.8;
       raft.address = options.address || UUID();
       raft.timers = new Tick(raft);
       raft.Log = options.Log;
       raft.change = change;
       raft.emits = emits;*/
    this.latency = 0;
    this.log = null;
    this.nodes = [];

  }


  async send(packet) {
    log.info('writing packet to socket on port %s', this.address);
    console.log(this.socket.send)
    return await new Promise(res =>
      this.socket.send(packet, res)
    )
  }

}

module.exports = ClientService;