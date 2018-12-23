const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  crypto = require('crypto'),
  states = require('../factories/stateFactory');

const append = async function (packet) {

  if (packet.leader !== this.leader) {
    this.logger.error('can\'t append logs not from leader');
    return null;
  }

  const {index, hash} = await this.log.getLastInfo();

  if ((packet.last.hash !== hash && packet.last.index === index) || (packet.last.hash === hash && packet.last.index !== index)) {

    this.logger.error('found another history root!');

    let term = packet.term > this.term ? this.term - 1 : packet.term - 1;

    let prevTerm = await this.log.getLastEntryByTerm(term);


    for (let logIndex = prevTerm.index + 1; logIndex <= index; logIndex++) {
      let entry = await this.log.get(logIndex);

      if (entry.owner !== this.publicKey) {
        this.logger.trace(`can't put command to orphan, as i am not a leader ${entry.owner} vs ${this.publicKey}`);
        continue;
      }

      this.logger.trace(`putting command back: ${JSON.stringify(entry.command.task)} to pending (by another root)`);
      await this.processor.push(entry.command.task);

    }


    this.logger.trace(`should drop ${index - prevTerm.index}, with current index ${index}, current term: ${term} and leader term ${packet.term}`);
    await this.log.removeEntriesAfter(prevTerm.index); //this clean up term
    this.term--; // todo check
    return null;
  }


  let reply = null;

  if (packet.data) {

    this.logger.info('going to append the data');//todo remove

    if (packet.data.index > index + 1)
      return null;


    if (index === packet.data.index) {

      let record = await this.log.get(packet.data.index);

      if (record.hash === packet.data.hash) {
        reply = await this.actions.message.packet(messageTypes.APPEND_ACK, {
          term: packet.data.term,
          index: packet.data.index
        });

        return {
          reply: reply,
          who: packet.publicKey
        };
      }

    }


    if (index >= packet.data.index) {

      this.logger.trace(`the leader has another history. Rewrite mine ${index} -> ${packet.data.index - 1}`);

      for (let logIndex = packet.data.index; logIndex <= index; logIndex++) {
        let entry = await this.log.get(logIndex);

        if (entry.owner !== this.publicKey) {
          this.logger.trace(`can't put command to orphan, as i am not a leader ${entry.owner} vs ${this.publicKey}`);
          continue;
        }

        if (_.find(entry.responses, {publicKey: packet.publicKey}))
          this.logger.trace(`trying to rewrite existent log ${entry.command.task}`);


        if (entry.responses.length >= this.majority())
          this.logger.trace(`trying to rewrite majority log ${entry.command.task}`);


        const taskHash = crypto.createHmac('sha256', JSON.stringify(packet.data.command.task)).digest('hex');
        this.logger.trace(`putting command back: ${JSON.stringify(entry.command.task)} to pending (rewrite mine) with confirmations ${entry.responses.length} with hash: ${taskHash}`);
        await this.processor.push(entry.command.task); //todo putting command back may change leader of log

      }

      await this.log.removeEntriesAfter(packet.data.index - 1);
    }


    const taskHash = crypto.createHmac('sha256', JSON.stringify(packet.data.command.task)).digest('hex');
    this.logger.trace(`validating and pulling duplicate task ${packet.data.command.task} with hash ${taskHash} from pending`);
    await this.log.pullPending(taskHash);


    try {
      this.logger.trace(`trying to save packet ${JSON.stringify(packet.data)}`);
      await this.log.saveCommand(packet.data.command, packet.data.term, packet.data.signature, packet.data.index, packet.data.hash, packet.data.owner); //todo replace entry owner with extract from signature
      this.logger.info(`the ${packet.data.index} has been saved`);
    } catch (err) {
      let {index: lastIndex} = await this.log.getLastInfo();
      this.logger.error(`error during save log: ${JSON.stringify(err)}`);

      if (err.code === 2 || err.code === 3)
        return;

      reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: lastIndex});

      return {
        reply: reply,
        who: states.LEADER
      };
    }

    this.logger.info('send append_ack packet');//todo remove
    reply = await this.actions.message.packet(messageTypes.APPEND_ACK, {
      term: packet.data.term,
      index: packet.data.index
    });

    return {
      reply: reply,
      who: packet.publicKey
    };

  }

};

const appendAck = async function (packet) {

  let replies = [];

  const entry = await this.log.commandAck(packet.data.index, packet.publicKey);

  this.logger.info(`append ack: ${packet.data.index} / ${entry.responses.length}`);

  if (this.quorum(entry.responses.length) && !entry.committed) {
    const entries = await this.log.getUncommittedEntriesUpToIndex(packet.data.index, packet.data.term);
    await this.commitEntries(entries);
  }

  if (this.state !== states.LEADER)
    return;

  let peers = _.chain(entry.responses).map(item => item.publicKey).pullAll([this.publicKey, packet.publicKey]).value();

  replies.push({
    reply: packet,
    who: peers
  });

  return replies;
};

const obtain = async function (packet) {

  let entry = await this.log.get(packet.last.index + 1);
  const reply = await this.actions.message.appendPacket(entry);

  return {
    who: packet.publicKey,
    reply: reply
  };
};

const appendFail = async function (packet) {

  let {index} = await this.log.getLastInfo();

  if (packet.data.index > index) {
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'wrong index!');
    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  let entity = await this.log.get(packet.data.index);

  let reply = await this.actions.message.appendPacket(entity);
  return {
    reply: reply,
    who: packet.publicKey
  };
};

module.exports = (instance) => {

  _.set(instance, 'actions.append', {
    append: append.bind(instance),
    appendAck: appendAck.bind(instance),
    appendFail: appendFail.bind(instance),
    obtain: obtain.bind(instance)
  });

};
