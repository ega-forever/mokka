const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  semaphore = require('semaphore');

class GossipRequestProcessor {

  constructor (mokka) {
    this.mokka = mokka;
    this.sem = semaphore(1);//todo check queue
  }

  async process (packet) {

    let data = await new Promise(res => {
      this.sem.take(async () => {
        let data = await this._process(packet);
        res(data);
        this.sem.leave();
      });
    });

    if (!_.has(data, 'who') && !_.has(data, '0.who')) //todo implement
      return;

    if (_.isArray(data)) {

      for (let item of data)
        await this.mokka.actions.message.message(item.who, item.reply);

      return;
    }

    await this.mokka.actions.message.message(data.who, data.reply);
  }


  async _process (packet) {

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
