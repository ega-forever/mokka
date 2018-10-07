const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  states = require('../factories/stateFactory');


const append = async function (packet, write) {

  const {index, hash} = await this.log.getLastInfo();

  if (packet.last.hash !== hash && packet.last.index === index) {//todo make rule for controlling alter-history (orphaned blocks)

    this.orhpanVotes.for = hash;

    let reply = await this.actions.message.packet(messageTypes.ORPHAN_VOTE, {hash: hash});

        await this.actions.message.message(states.CANDIDATE, reply);
        await this.actions.message.message(states.CHILD, reply);
  }

  if (packet.last.index !== index && packet.last.index !== 0) {
    const hasIndex = await this.log.has(packet.last.index);


    if (!hasIndex) {
      let {index: lastIndex} = await this.log.getLastInfo(); //todo validate
      let reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: lastIndex + 1});
      return this.actions.message.message(states.LEADER, reply);
    }
  }

  if (packet.data) {
    const entry = packet.data[0]; //todo make validation of appended packet (can't rewrite chain)

    try {
      await this.log.saveCommand(entry.command, entry.term, entry.index, entry.hash);
    } catch (e) {
      let {index: lastIndex} = await this.log.getLastInfo();
      let reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: lastIndex + 1});
      return this.actions.message.message(states.LEADER, reply);
    }

    let reply = await this.actions.message.packet(messageTypes.APPEND_ACK, {
      term: entry.term,
      index: entry.index
    });

    this.actions.message.message(states.LEADER, reply);
  }

  if (this.log.committedIndex < packet.last.committedIndex) {
    const entries = await this.log.getUncommittedEntriesUpToIndex(packet.last.committedIndex, packet.last.term);
    await this.commitEntries(entries);
  }
};

const appendAck = async function (packet, write) {

  const entry = await this.log.commandAck(packet.data.index, packet.publicKey);
  if (this.quorum(entry.responses.length) && !entry.committed) {
    const entries = await this.log.getUncommittedEntriesUpToIndex(entry.index, entry.term);
    await this.commitEntries(entries);
  }

  this.emit('append_ack', entry.index);
};

const appendFail = async function(packet, write){

  let previousEntry = await this.log.get(packet.data.index);

  if (!previousEntry)
    previousEntry = await this.log.getLastEntry();

  const append = await this.actions.message.appendPacket(previousEntry);
  write(append);
};

module.exports = (instance) => {

  _.set(instance, 'actions.append', {
    append: append.bind(instance),
    appendAck: appendAck.bind(instance),
    appendFail: appendFail.bind(instance)
  });

};
