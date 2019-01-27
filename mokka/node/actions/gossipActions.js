const messageTypes = require('../factories/messageTypesFactory');


class GossipActions {

  constructor (mokka) {
    this.mokka = mokka;
  }


  async request (packet) {

    let sc = await this.mokka.gossip.scuttle.scuttle(packet.data.digest);
    this.mokka.gossip.handleNewPeers(sc.newPeers);

    let data = {
      requestDigest: sc.requests,
      updates: sc.deltas
    };

    const reply = await this.mokka.actions.message.packet(messageTypes.GOSSIP_FIRST_RESPONSE, data);

    return {
      who: packet.publicKey,
      reply: reply
    };
  }

  async firstResponse (packet) {

    await this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);

    let updates = await this.mokka.gossip.scuttle.fetchDeltas(packet.data.requestDigest);

    let data = {
      updates: updates
    };

    const reply = await this.mokka.actions.message.packet(messageTypes.GOSSIP_SECOND_RESPONSE, data);

    return {
      who: packet.publicKey,
      reply: reply
    };
  }

  async secondResponse (packet) {
    await this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);
  }


}

module.exports = GossipActions;
