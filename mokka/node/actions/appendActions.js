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
      await this.mokka.log.entry.removeAfter(prevTerm.index - 1); //this clean up term
      return null;
    }


    if (!packet.data)
      return null;

    if (_.isArray(packet.data))
      return await Promise.mapSeries(packet.data, async item => {
        let newPacket = _.cloneDeep(packet);
        newPacket.data = item;
        return await this.append(newPacket);
      });


    let reply = null;

    if (packet.data.index > lastInfo.index + 1)
      return null;


    if (lastInfo.index === packet.data.index) {

      let record = await this.mokka.log.entry.get(packet.data.index);

      if (record && record.hash === packet.data.hash) {
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


      //todo make rule for committed entry
      await this.mokka.log.command.save(packet.data.command, packet.data.term, packet.data.signature, packet.data.index, packet.data.hash, packet.data.responses);
      //todo add self ack


      this.mokka.logger.info(`the ${packet.data.index} has been saved`);
    } catch (err) {
      this.mokka.logger.error(`error during save log: ${JSON.stringify(err)}`);

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
      const entries = await this.mokka.log.entry.getUncommittedUpToIndex(packet.data.index);
      for (let entry of entries) {
        await this.mokka.applier(entry.command, this.mokka.log.state.getApplierFuncs(entry.index));
        await this.mokka.log.command.commit(entry.index);
        this.mokka.emit(eventTypes.ENTRY_COMMITTED, entry.index);
      }
    }

    if (this.mokka.removeSynced && entry.responses.length === this.mokka.nodes.length + 1) { //todo remove old terms as well
      await this.mokka.log.state.takeSnapshot(entry.index);
      await this.mokka.log.entry.removeTo(entry.index);
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

  async obtain (packet, limit = 100) { //todo send state along side with logs

    let entries = await this.mokka.log.entry.getAfterList(packet.last.index, limit);

    let isRecent = _.get(entries, '0.index', packet.last.index) === packet.last.index && entries.length === 0;


    if (this.mokka.removeSynced && !isRecent)
      return await this._obtainState(packet);

    return await this._obtainLogs(packet);
  }


  async _obtainState (packet) {

    let snapshotState = await this.mokka.log.state.getSnapshotState();

    if(snapshotState.index === 0 || await this.mokka.log.state._isSnapshotOutdated(packet.last.index)){
      await this.mokka.log.state.takeSnapshot()//todo
    }

    let info = await this.mokka.log.entry.getLastInfo();


    let skip = 0;

    if(packet.data.state.lastAppliedIndex === snapshotState.index && snapshotState.count - packet.data.state.count > 0)
      skip = snapshotState.count - packet.data.state.count;


    let triggersChunk = await this.mokka.log.state.getSnapshot(packet.last.index, skip, 100);

    let reply = await this.mokka.actions.message.packet(messageTypes.STATE, {
      state: triggersChunk,
      info: snapshotState
    });
    const {proof} = await this.mokka.log.proof.get(info.term);
    reply.proof = proof;

    return {
      who: packet.publicKey,
      reply: reply
    };

  }

  async _obtainLogs (packet) {


    let entries = await this.mokka.log.entry.getAfterList(packet.last.index, 100);

    entries = _.groupBy(entries, 'term');
    let replies = [];


    for (let term of Object.keys(entries)) {

      let reply = await this.mokka.actions.message.appendPacket(entries[term][0]);
      reply.data = entries[term];

      replies.push({
        who: packet.publicKey,
        reply: reply
      });
    }

    return replies;
  }

  async appendState (packet) { //todo include index


    let lastAppliedIndex = await this.mokka.log.state.getLastApplied();
    let count = await this.mokka.log.state.getCount();//todo

    console.log(lastAppliedIndex, count, '/', packet.data.info.index, packet.data.info.count)

    if(lastAppliedIndex > packet.data.info.index || (lastAppliedIndex === packet.data.info.index && packet.data.info.count === count))
      return;

    for (let key of Object.keys(packet.data.state))
      await this.mokka.log.state.put(packet.data.info.index, key, packet.data.state[key], true);

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
