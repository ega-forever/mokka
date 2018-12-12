const _ = require('lodash'),
  Promise = require('bluebird'),
  states = require('../factories/stateFactory'),
  messageTypes = require('../factories/messageTypesFactory');


const _timing = function (latency = []) {

  if (states.STOPPED === this.state)
    return false;

  this.latency = Math.floor(_.sum(latency) / latency.length);

  if (this.latency > this.election.min * this.threshold)
    this.emit('threshold');


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
        if (mokka.leader === node.publicKey)
          nodes.push(node);

      break;

    case states.FOLLOWER:
      for (let node of mokka.nodes)
        if (mokka.leader !== node.publicKey)
          nodes.push(node);

      break;

    case states.CHILD:
      Array.prototype.push.apply(nodes, mokka.nodes);
      break;

    default:
      for (let node of mokka.nodes)
        if ((_.isArray(who) && who.includes(node.publicKey)) || who === node.publicKey)
          nodes.push(node);

  }


  await Promise.some(nodes.map(async client => {

    let start = Date.now();
    let output = {
      client: client.publicKey,
      error: null,
      data: null
    };

    let item = new Promise((res, rej) => client.write(what, (err, data) => err ? rej(err) : res(data))); //todo ack on each action

    item = options.timeout ?
      await item.timeout(options.timeout) : await item;
    output.data = item;
    mokka.emit('data', item);


    latency.push(Date.now() - start);

    return output;
  }), options.minConfirmations);


  _timing.call(mokka, latency);

};

const packet = async function (type, data) {

    const wrapped = {
      state: this.state,
      term: this.term,
      address: this.address, //todo remove
      publicKey: this.publicKey,
      type: type,
      leader: this.leader
    };


  wrapped.last = await this.log.getLastInfo();

  if (data)
    wrapped.data = data;

  return wrapped;
};

const appendPacket = async function (entry) {
  const mokka = this;
  const last = await mokka.log.getEntryInfoBefore(entry);
  const proofEntry = await this.log.getFirstEntryByTerm(entry.term);


  let proof = {
    index: proofEntry.index,
    hash: proofEntry.hash
  };

  if (entry.index === proofEntry.index)
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
