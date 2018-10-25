const _ = require('lodash'),
  Promise = require('bluebird'),
  semaphore = require('semaphore'),
  states = require('../factories/stateFactory'),
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
    raft = this,
    nodes = [];

  if (!_.has(options, 'minConfirmations'))
    options.minConfirmations = _.isArray(who) ? who.length : 1;

  switch (who) {
    case states.LEADER:
      for (let node of raft.nodes)
        if (raft.leader === node.publicKey) {
          nodes.push(node);
        }
      break;

    case states.FOLLOWER:
      for (let node of raft.nodes)
        if (raft.leader !== node.publicKey) {
          nodes.push(node);
        }
      break;

    case states.CHILD:
      Array.prototype.push.apply(nodes, raft.nodes);
      break;

    default:
      for (let node of raft.nodes)
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
      raft.emit('data', item);

    } catch (err) {

      if (err instanceof Promise.TimeoutError)
        return console.log(`[${Date.now()}]timeout error[${this.index}]`);

      output.error = err;
      raft.emit('error', err);
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
      _timing.call(raft, latency);

      if (options.serial)
        sem.leave();
      res();
    });

  });


  if (options.ensure)
    await op2;

};

const packet = async function (type, data) {
  let raft = this,
    wrapped = {
      state: raft.state,
      term: raft.term,
      address: raft.address, //todo remove
      publicKey: raft.publicKey,
      type: type,
      leader: raft.leader
    };


  wrapped.last = await raft.log.getLastInfo();

  if (arguments.length === 2)
    wrapped.data = data;

  return wrapped;
};

const appendPacket = async function (entry) {
  const raft = this;
  const last = await raft.log.getEntryInfoBefore(entry);
  const proofEntry = await this.log.getFirstEntryByTerm(this.term);

  /*  if(this.term > 0){
      console.log(proofEntry);
      let proof = await this.log.termDb.get(this.term);
      console.log(proof)
      process.exit(0)
    }*/

  entry = _.isArray(entry) ? entry : [entry];

//  let includesStartLog = _.find(entry, {index: proofEntry.index});

/*
  let proof = includesStartLog ?
    {
      shares: proofEntry.proof.shares,
      secret: proofEntry.proof.secret
    } : {
      index: proofEntry.index,
      hash: proofEntry.hash
    };
*/

  return {
    state: raft.state,
    term: raft.term,
    address: raft.address, //todo remove
    publicKey: raft.publicKey,
    type: messageTypes.APPEND,
    leader: raft.leader,
    proof: proofEntry,
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
