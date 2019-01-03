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

      let prevTerm = await this.mokka.log.getLastEntryByTerm(term);


      for (let logIndex = prevTerm.index + 1; logIndex <= this.mokka.lastInfo.index; logIndex++) {
        let entry = await this.mokka.log.get(logIndex);

        if (entry.owner !== this.mokka.publicKey) {
          this.mokka.logger.trace(`can't put command to orphan, as i am not a leader ${entry.owner} vs ${this.mokka.publicKey}`);
          continue;
        }

        this.mokka.logger.trace(`putting command back: ${JSON.stringify(entry.command.task)} to pending (by another root)`);
        await this.mokka.processor.push(entry.command.task);

      }


      this.mokka.logger.trace(`should drop ${this.mokka.lastInfo.index - prevTerm.index}, with current index ${this.mokka.lastInfo.index}, current term: ${term} and leader term ${packet.term}`);
      await this.mokka.log.removeEntriesAfter(prevTerm.index); //this clean up term
      this.mokka.term--; // todo check
      return null;
    }


    let reply = null;

    if (packet.data) {

      if (packet.data.index > this.mokka.lastInfo.index + 1)
        return null;


      if (this.mokka.lastInfo.index === packet.data.index) {

        let record = await this.mokka.log.get(packet.data.index);

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

        for (let logIndex = packet.data.index; logIndex <= this.mokka.lastInfo.index; logIndex++) {
          let entry = await this.mokka.log.get(logIndex);

          if (entry.owner !== this.mokka.publicKey) {
            this.mokka.logger.trace(`can't put command to orphan, as i am not a leader ${entry.owner} vs ${this.mokka.publicKey}`);
            continue;
          }

          if (_.find(entry.responses, {publicKey: packet.publicKey}))
            this.mokka.logger.trace(`trying to rewrite existent log ${entry.command.task}`);


          if (entry.responses.length >= this.mokka.majority())
            this.mokka.logger.trace(`trying to rewrite majority log ${entry.command.task}`);


          const taskHash = crypto.createHmac('sha256', JSON.stringify(packet.data.command.task)).digest('hex');
          this.mokka.logger.trace(`putting command back: ${JSON.stringify(entry.command.task)} to pending (rewrite mine) with confirmations ${entry.responses.length} with hash: ${taskHash}`);
          await this.mokka.processor.push(entry.command.task); //todo putting command back may change leader of log

        }

        await this.mokka.log.removeEntriesAfter(packet.data.index - 1);
      }


      const taskHash = crypto.createHmac('sha256', JSON.stringify(packet.data.command.task)).digest('hex');
      this.mokka.logger.trace(`validating and pulling duplicate task ${packet.data.command.task} with hash ${taskHash} from pending`);
      await this.mokka.log.pullPending(taskHash);


      try {
        this.mokka.logger.trace(`trying to save packet ${JSON.stringify(packet.data)}`);
        await this.mokka.log.saveCommand(packet.data.command, packet.data.term, packet.data.signature, packet.data.index, packet.data.hash);
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
  };

  async appendAck (packet) {

    let replies = [];

    const entry = await this.mokka.log.commandAck(packet.data.index, packet.publicKey);

    this.mokka.logger.info(`append ack: ${packet.data.index} / ${entry.responses.length}`);

    if (this.mokka.quorum(entry.responses.length) && !entry.committed) {
      const entries = await this.mokka.log.getUncommittedEntriesUpToIndex(packet.data.index, packet.data.term);
      for (let entry of entries) {
        await this.mokka.log.commit(entry.index);
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
  };

  async obtain (packet) {

    let entry = await this.mokka.log.get(packet.last.index + 1);
    const reply = await this.mokka.actions.message.appendPacket(entry);

    return {
      who: packet.publicKey,
      reply: reply
    };
  };

  async proposed (packet) {//todo add signature check

    let entry = await this.mokka.log.putPending(packet.data);

    const reply = await this.mokka.actions.message.packet(messageTypes.APPEND_PENDING, entry.hash);

    return {
      who: packet.publicKey,
      reply: reply
    };
  };

  async appendAckPending (packet) {//todo add signature check
    await this.mokka.log.ackPending(packet.data);
    this.mokka.emit(eventTypes.PENDING_COMMITTED, packet.data);
  };

  async appendFail (packet) {

    if (packet.data.index > this.mokka.lastInfo.index) {
      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'wrong index!');
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    let entity = await this.mokka.log.get(packet.data.index);

    let reply = await this.mokka.actions.message.appendPacket(entity);
    return {
      reply: reply,
      who: packet.publicKey
    };
  };


}

module.exports = AppendActions;
