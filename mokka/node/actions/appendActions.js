const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.actions.append'}),
  states = require('../factories/stateFactory');

const append = async function (packet) { //todo move write to index.js

  if (packet.leader !== this.leader) {
    log.error('can\'t append logs not from leader');
    return null;
  }

  const {index, hash} = await this.log.getLastInfo();

  if ((packet.last.hash !== hash && packet.last.index === index) || (packet.last.hash === hash && packet.last.index !== index)) {//todo make rule for controlling alter-history (orphaned blocks)

    log.error('found another history root!');

    let term = packet.term > this.term ? this.term - 1 : packet.term - 1;

    let prevTerm = await this.log.getLastEntryByTerm(term);
    await this.log.removeEntriesAfter(prevTerm.index);
    return null;
  }


  let reply = null;

  if (packet.data) {

    if(packet.data.index > index + 1)
      return null;

    if (index >= packet.data.index) { //not next log to append
      log.info(`the leader has another history. Rewrite mine ${index} -> ${packet.data.index - 1}`);
      await this.log.removeEntriesAfter(packet.data.index - 1);
    }


    try {
      await this.log.saveCommand(packet.data.command, packet.data.term, packet.data.index, packet.data.hash, packet.data.owner);
      log.info(`the ${packet.data.index} has been saved`);
    } catch (err) {
      let {index: lastIndex} = await this.log.getLastInfo();
      log.error(`error during save log: ${JSON.stringify(err)}`);

      if (err.code === 2 || err.code === 3)
        return;

      reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: lastIndex});

      return {
        reply: reply,
        who: states.LEADER
      };
    }

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

  log.info(`append ack: ${packet.data.index} / ${entry.responses.length}`);

  if (this.quorum(entry.responses.length) && !entry.committed) {
    const entries = await this.log.getUncommittedEntriesUpToIndex(packet.data.index, packet.data.term);
    await this.commitEntries(entries);
  }

  this.emit(states.APPEND_ACK, entry.index);

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
