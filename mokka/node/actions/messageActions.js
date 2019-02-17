const _ = require('lodash'),
  states = require('../factories/stateFactory'),
  encodePacketUtils = require('../../utils/encodePacket'),
  messageTypes = require('../factories/messageTypesFactory');


class MessageActions {

  constructor (mokka) {
    this.mokka = mokka;
  }

  async message (who, what) {

    let nodes = [];

    switch (who) {
      case states.LEADER:
        for (let node of this.mokka.nodes)
          if (this.mokka.leader === node.publicKey)
            nodes.push(node);

        break;

      case states.FOLLOWER:
        for (let node of this.mokka.nodes)
          if (this.mokka.leader !== node.publicKey)
            nodes.push(node);

        break;

      case states.CHILD:
        Array.prototype.push.apply(nodes, this.mokka.nodes);
        break;

      default:
        for (let node of this.mokka.nodes)
          if ((_.isArray(who) && who.includes(node.publicKey)) || who === node.publicKey)
            nodes.push(node);

    }

    for (let client of nodes)
      client.write(encodePacketUtils(what));


    // _timing.call(mokka, latency); //todo implement timing

  }


  async packet (type, data) {

    const wrapped = {
      state: this.mokka.state,
      term: this.mokka.term,
      publicKey: this.mokka.publicKey,//todo remove
      type: type
    };


    wrapped.last = await this.mokka.log.entry.getLastInfo();

    if (data)
      wrapped.data = data;

    return wrapped;
  }


  async appendPacket (entry) {

    const {proof} = await this.mokka.log.proof.get(entry ? entry.term : this.mokka.term);

    let payload = {
      state: this.mokka.state,
      term: entry ? entry.term : this.mokka.term,
      publicKey: this.mokka.publicKey,//todo remove
      type: messageTypes.APPEND,
      proof: proof
    };


    if (entry) {
      payload.data = _.pick(entry, ['command', 'term', 'signature', 'index', 'hash', 'responses', 'committed']);
      payload.last = await this.mokka.log.entry.getInfoBefore(entry);
    } else
      payload.last = await this.mokka.log.entry.getLastInfo();


    return payload;
  }


}


module.exports = MessageActions;
