const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  eventTypes = require('../factories/eventTypesFactory'),
  crypto = require('crypto'),
  Promise = require('bluebird'),
  states = require('../factories/stateFactory');

class AppendActions {

  constructor (mokka) {
    this.mokka = mokka;
  }

  async append (packet) {

    let lastInfo = await this.mokka.log.entry.getLastInfo();

    if ((packet.last.hash !== lastInfo.hash && packet.last.index === lastInfo.index) || (packet.last.hash === lastInfo.hash && packet.last.index !== lastInfo.index)) {

      this.mokka.logger.error('found another history root!', packet.last.hash === lastInfo.hash, packet.last.index === lastInfo.index);

      let term = packet.term > this.mokka.term ? this.mokka.term - 1 : packet.term - 1;
      let prevTerm = await this.mokka.log.entry.getLastByTerm(term);

      this.mokka.logger.trace(`should drop ${lastInfo.index - prevTerm.index}, with current index ${lastInfo.index}, current term: ${term} and leader term ${packet.term}`);
      await this.mokka.log.entry.removeAfter(prevTerm.index - 1, true); //this clean up term
      return null;
    }




    if(!packet.data)
      return null;

    if(_.isArray(packet.data)){
      console.log(`looping through array ${packet.data[0].index} to ${_.last(packet.data).index}`);
      return await Promise.mapSeries(packet.data, async item=> {
        let newPacket = _.cloneDeep(packet);
        newPacket.data = item;
        return await this.append(newPacket);
      });
    }


    let reply = null;

    if (packet.data.index > lastInfo.index + 1)
      return null;


    if (lastInfo.index === packet.data.index) {

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

    if (lastInfo.index >= packet.data.index) {//todo send ack
      return null;
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

      console.log(`current history ${lastInfo.index}`);

      if (err.code === 2 || err.code === 3)
        return;

      reply = await this.mokka.actions.message.packet(messageTypes.APPEND_FAIL, {index: lastInfo.index});

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

  async obtain (packet, limit = 100) { //todo implement the limit, combine by term

    let entries = await this.mokka.log.entry.getAfterList(packet.last.index, limit);

    console.log(`!!obtaining ${entries.length} from ${entries[0].index} to ${_.last(entries).index} while current is ${packet.last.index}`)


    entries = _.groupBy(entries, 'term');


    let replies = [];

    for(let term of Object.keys(entries)){

      let reply = await this.mokka.actions.message.appendPacket(entries[term][0]);
      reply.data = entries[term];

      replies.push({
        who: packet.publicKey,
        reply: reply
      });

    }

    console.log(`going to send ${replies.length} replies`)

    return replies;

  /*  let reply = await this.mokka.actions.message.appendPacket(entries);

    return {
      who: packet.publicKey,
      reply: reply
    };*/

  }

  async appendFail (packet) {

    let lastInfo = await this.mokka.log.entry.getLastInfo();

    if (packet.data.index > lastInfo.index) {
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
