const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  eventTypes = require('../factories/eventTypesFactory'),
  crypto = require('crypto'),
  states = require('../factories/stateFactory');

class AppendActions {

  constructor (mokka) {
    this.mokka = mokka;
  }

  async append (packet) {

    if ((packet.last.hash !== this.mokka.lastInfo.hash && packet.last.index === this.mokka.lastInfo.index) || (packet.last.hash === this.mokka.lastInfo.hash && packet.last.index !== this.mokka.lastInfo.index)) {

      this.mokka.logger.error('found another history root!');

      let term = packet.term > this.mokka.term ? this.mokka.term - 1 : packet.term - 1;
      let prevTerm = await this.mokka.log.entry.getLastByTerm(term);

      this.mokka.logger.trace(`should drop ${this.mokka.lastInfo.index - prevTerm.index}, with current index ${this.mokka.lastInfo.index}, current term: ${term} and leader term ${packet.term}`);
      await this.mokka.log.entry.removeAfter(prevTerm.index - 1, true); //this clean up term
      return null;
    }

    let reply = null;

    if (!packet.data || packet.data.index > this.mokka.lastInfo.index + 1)
      return null;


    if (this.mokka.lastInfo.index === packet.data.index) {

      let record = await this.mokka.log.entry.get(packet.data.index);

      if (record.hash === packet.data.hash) {
        reply = await this.mokka.actions.message.packet(messageTypes.APPEND_ACK, {
          term: packet.data.term,
          index: packet.data.index
        });

        return {
          reply: reply,
          who: packet.publicKey
        };
      }
    }


    if (this.mokka.lastInfo.index >= packet.data.index) {
      this.mokka.logger.trace(`the leader has another history. Rewrite mine ${this.mokka.lastInfo.index} -> ${packet.data.index - 1}`);
      await this.mokka.log.entry.removeAfter(packet.data.index - 1, true);
    }


    const commandHash = crypto.createHmac('sha256', JSON.stringify(packet.data.command)).digest('hex');
    this.mokka.logger.trace(`validating and pulling duplicate command ${packet.data.command} with hash ${commandHash} from pending`);
    await this.mokka.log.pending.pull(commandHash);


    try {
      this.mokka.logger.trace(`trying to save packet ${JSON.stringify(packet.data)}`);
      await this.mokka.log.command.save(packet.data.command, packet.data.term, packet.data.signature, packet.data.index, packet.data.hash);
      this.mokka.logger.info(`the ${packet.data.index} has been saved`);
    } catch (err) {
      this.mokka.logger.error(`error during save log: ${JSON.stringify(err)}`);

      if (err.code === 2 || err.code === 3)
        return;

      reply = await this.mokka.actions.message.packet(messageTypes.APPEND_FAIL, {index: this.mokka.lastInfo.index});

      return {
        reply: reply,
        who: states.LEADER
      };
    }

    reply = await this.mokka.actions.message.packet(messageTypes.APPEND_ACK, {
      term: packet.data.term,
      index: packet.data.index
    });

    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  async appendAck (packet) {

    let replies = [];

    const entry = await this.mokka.log.command.ack(packet.data.index, packet.publicKey);

    this.mokka.logger.info(`append ack: ${packet.data.index} / ${entry.responses.length}`);

    if (this.mokka.quorum(entry.responses.length) && !entry.committed) {
      const entries = await this.mokka.log.entry.getUncommittedUpToIndex(packet.data.index, packet.data.term);
      for (let entry of entries) {
        await this.mokka.log.command.commit(entry.index);
        this.mokka.emit(eventTypes.ENTRY_COMMITTED, entry.index);
      }
    }

    if (this.mokka.state !== states.LEADER)
      return;

    let peers = _.chain(entry.responses).map(item => item.publicKey).pullAll([this.mokka.publicKey, packet.publicKey]).value();

    replies.push({
      reply: packet,
      who: peers
    });

    return replies;
  }

  async obtain (packet) {

    let entry = await this.mokka.log.entry.get(packet.last.index + 1);
    const reply = await this.mokka.actions.message.appendPacket(entry);

    return {
      who: packet.publicKey,
      reply: reply
    };
  }

  async appendFail (packet) {

    if (packet.data.index > this.mokka.lastInfo.index) {
      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'wrong index!');
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    let entity = await this.mokka.log.entry.get(packet.data.index);

    let reply = await this.mokka.actions.message.appendPacket(entity);
    return {
      reply: reply,
      who: packet.publicKey
    };
  }


}

module.exports = AppendActions;
