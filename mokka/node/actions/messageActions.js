const _ = require('lodash'),
  Promise = require('bluebird'),
  semaphore = require('semaphore'),
  states = require('../factories/stateFactory'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.actions.message'}),
  messageTypes = require('../factories/messageTypesFactory');

const sems = _.chain(messageTypes)
  .values()
  .map(key => [key, semaphore(1)])
  .fromPairs()
  .value();

const _timing = function (latency = []) {

  if (states.STOPPED === this.state)
    return false;

  this.latency = Math.floor(_.sum(latency) / latency.length);

  if (this.latency > this.election.min * this.threshold) {
    this.emit('threshold');
  }


  return true;
};

const message = async function (who, what, options = {}) {

  let latency = [],
    mokka = this,
    nodes = [];

  if (!_.has(options, 'minConfirmations'))
    options.minConfirmations = _.isArray(who) ? who.length : 1;

  switch (who) {
    case states.LEADER:
      for (let node of mokka.nodes)
        if (mokka.leader === node.publicKey) {
          nodes.push(node);
        }
      break;

    case states.FOLLOWER:
      for (let node of mokka.nodes)
        if (mokka.leader !== node.publicKey) {
          nodes.push(node);
        }
      break;

    case states.CHILD:
      Array.prototype.push.apply(nodes, mokka.nodes);
      break;

    default:
      for (let node of mokka.nodes)
        if (who === node.publicKey) {
          nodes.push(node);
        }
  }

  let op = Promise.some(nodes.map(async client => {

    let start = Date.now();
    let output = {
      client: client.publicKey,
      error: null,
      data: null
    };


    try {
      let item = new Promise((res, rej) => client.write(what, (err, data) => err ? rej(err) : res(data))); //todo ack on each action

      item = options.timeout ?
        await item.timeout(options.timeout) : await item;
      output.data = item;
      mokka.emit('data', item);

    } catch (err) {

      if (err instanceof Promise.TimeoutError) {
        log.error(`timeout error on waiting for record confirmation. Type - ${what.type}`);
      }

      output.error = err;
      mokka.emit('error', err);
    }

    latency.push(Date.now() - start);

    return output;
  }), options.minConfirmations);

  let sem = sems[what.type];

  let op2 = new Promise(res => {

    sem.take(async function () {

      if (!options.serial)
        sem.leave();

      await op;
      _timing.call(mokka, latency);

      if (options.serial)
        sem.leave();
      res();
    });

  });


  if (options.ensure)
    await op2;

};

const packet = async function (type, data) {
  let mokka = this,
    wrapped = {
      state: mokka.state,
      term: mokka.term,
      address: mokka.address, //todo remove
      publicKey: mokka.publicKey,
      type: type,
      leader: mokka.leader
    };


  wrapped.last = await mokka.log.getLastInfo();

  if (arguments.length === 2)
    wrapped.data = data;

  return wrapped;
};

const appendPacket = async function (entry) {
  const mokka = this;
  const last = await mokka.log.getEntryInfoBefore(entry);
  const proofEntry = await this.log.getFirstEntryByTerm(this.term);

  entry = _.isArray(entry) ? entry : [entry];

 let includesStartLog = _.find(entry, {index: proofEntry.index});


 let proof = {
   index: proofEntry.index,
   hash: proofEntry.hash
 };

 if(includesStartLog)
   _.merge(proof, proofEntry);

  return {
    state: mokka.state,
    term: mokka.term,
    address: mokka.address, //todo remove
    publicKey: mokka.publicKey,
    type: messageTypes.APPEND,
    leader: mokka.leader,
    proof: proof,
    data: entry,
    last
  };
};

module.exports = (instance) => {

  _.set(instance, 'actions.message', {
    message: message.bind(instance),
    packet: packet.bind(instance),
    appendPacket: appendPacket.bind(instance)
  });

};
