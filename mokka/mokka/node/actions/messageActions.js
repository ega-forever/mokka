const _ = require('lodash'),
  Promise = require('bluebird'),
  semaphore = require('semaphore'),
  states = require('../factories/stateFactory'),
  messageTypes = require('../factories/messageTypesFactory');

const sems = _.chain(messageTypes)
  .values()
  .map(key=>[key, semaphore(1)])
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

  let op = Promise.all(nodes.map(async client => {

    let start = Date.now();
    let output = {
      client: client.publicKey,
      error: null,
      data: null
    };


    try {
      let item = await new Promise((res, rej) => client.write(what, (err, data) => err ? rej(err) : res(data))).timeout(this.election.max);//todo ack on each action
      output.data = item;
      raft.emit('data', item);

    } catch (err) {

      if(err instanceof Promise.TimeoutError)
        return;

      output.error = err;
      raft.emit('error', err);
    }

    latency.push(Date.now() - start);

    return output;
  }));

  let sem = sems[what.type];


  let op2 = new Promise(res => {

    sem.take(async function () {

      if (!options.serial)
        sem.leave();

      await op;
      _timing.apply(raft, latency);

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
  return {
    state: raft.state,
    term: raft.term,
    address: raft.address, //todo remove
    publicKey: raft.publicKey,
    type: messageTypes.APPEND,
    leader: raft.leader,
    data: _.isArray(entry) ? entry : [entry],
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
