const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  eventTypes = require('../factories/eventTypesFactory'),
  crypto = require('crypto'),
  states = require('../factories/stateFactory');

const request = async (packet) => {

  let sc = this.gossip.scuttle.scuttle(packet.data); //todo request from gossip
  this.gossip.handleNewPeers(sc.new_peers);//todo implement in gossip

  let data = {
    request_digest: sc.requests,
    updates: sc.deltas
  };

  const reply = await this.actions.message.packet(messageTypes.GOSSIP_FIRST_RESPONSE, data);

  return {
    who: packet.publicKey,//todo to whom?
    reply: reply
  };
};

const firstResponse = async packet=>{

  this.scuttle.updateKnownState(packet.data.updates);

  let data = {
    updates: this.gossip.scuttle.fetchDeltas(packet.data.request_digest)
  };

  const reply = await this.actions.message.packet(messageTypes.GOSSIP_SECOND_RESPONSE, data);

  return {
    who: packet.publicKey,//todo to whom?
    reply: reply
  };
};

const secondResponse = async packet=>{
  this.gossip.scuttle.updateKnownState(packet.data.updates);
};

module.exports = (instance) => {

  _.set(instance, 'actions.gossip', {
    request: request.bind(instance),
    firstResponse: firstResponse.bind(instance),
    secondResponse: secondResponse.bind(instance)
  });

};