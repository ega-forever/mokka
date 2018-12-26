const _ = require('lodash'),
  states = require('../factories/stateFactory'),
  encodePacketUtils = require('../../utils/encodePacket'),
  messageTypes = require('../factories/messageTypesFactory');


const message = async function (who, what) {

  let mokka = this,
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

  for (let client of nodes)
    client.write(encodePacketUtils(what));


  // _timing.call(mokka, latency); //todo implement timing

};

const packet = async function (type, data) {

  const wrapped = {
    state: this.state,
    term: this.term,
    publicKey: this.publicKey,//todo remove
    type: type
  };


  wrapped.last = this.lastInfo;

  if (data)
    wrapped.data = data;

  return wrapped;
};

const appendPacket = async function (entry) {

  const {proof} = await this.log.getProof(entry ? entry.term : this.term);

  let payload = {
    state: this.state,
    term: entry ? entry.term : this.term,
    publicKey: this.publicKey,//todo remove
    type: messageTypes.APPEND,
    proof: proof
  };


  if(entry){
    payload.data = _.pick(entry, ['command', 'term', 'signature', 'index', 'hash']);
    payload.last = await this.log.getEntryInfoBefore(entry);
  }else 
    payload.last = this.lastInfo;
  

  return payload;
};

module.exports = (instance) => {

  _.set(instance, 'actions.message', {
    message: message.bind(instance),
    packet: packet.bind(instance),
    appendPacket: appendPacket.bind(instance)
  });

};
