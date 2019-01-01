const messageTypes = require('../factories/messageTypesFactory');

class GossipRequestProcessor {

  constructor (mokka) {
    this.mokka = mokka;
  }


  async process (packet) {

    let reply;

    if (packet.type === messageTypes.GOSSIP_REQUEST)
      reply = await this.mokka.actions.gossip.request(packet);

    if (packet.type === messageTypes.GOSSIP_FIRST_RESPONSE)
      reply = await this.mokka.actions.gossip.firstResponse(packet);

    if (packet.type === messageTypes.GOSSIP_SECOND_RESPONSE)
      reply = await this.mokka.actions.gossip.secondResponse(packet);

    return reply;

  }

}


module.exports = GossipRequestProcessor;
