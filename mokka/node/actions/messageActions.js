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

const message = async function (who, what) {

  let latency = [],
    mokka = this,
    nodes = [];

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

  for(let client of nodes)
    client.write(what);


 // _timing.call(mokka, latency); //todo implement timing

};

const packet = async function (type, data) {

    const wrapped = {
      state: this.state,
      term: this.term,
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
