const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  eventTypes = require('../factories/eventTypesFactory'),
  crypto = require('crypto'),
  states = require('../factories/stateFactory');


class GossipActions {

  constructor (mokka) {
    this.mokka = mokka;
  }


  async request (packet) {

    let sc = this.mokka.gossip.scuttle.scuttle(packet.data.digest); //todo request from gossip
    this.mokka.gossip.handleNewPeers(sc.new_peers);//todo implement in gossip

    let data = {
      request_digest: sc.requests,
      updates: sc.deltas
    };

    const reply = await this.mokka.actions.message.packet(messageTypes.GOSSIP_FIRST_RESPONSE, data);

    return {
      who: packet.publicKey,//todo to whom?
      reply: reply
    };
  }

  async firstResponse (packet) {

    this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);

    let data = {
      updates: this.mokka.gossip.scuttle.fetchDeltas(packet.data.request_digest)
    };

    const reply = await this.mokka.actions.message.packet(messageTypes.GOSSIP_SECOND_RESPONSE, data);

    return {
      who: packet.publicKey,//todo to whom?
      reply: reply
    };
  }

  async secondResponse (packet) {
    this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);
  }


}

module.exports = GossipActions;

/*
module.exports = (instance) => {

  _.set(instance, 'actions.gossip', {
    request: request.bind(instance),
    firstResponse: firstResponse.bind(instance),
    secondResponse: secondResponse.bind(instance)
  });

};*/
