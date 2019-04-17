import {Promise} from 'bluebird';
import * as crypto from 'crypto';
import * as _ from 'lodash';
import {EntryModel} from '../../storage/models/EntryModel';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {ReplyModel} from '../models/ReplyModel';
import {MessageApi} from './MessageApi';

class AppendApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async append(packet: PacketModel): Promise<ReplyModel[] | ReplyModel | null> {

    if (!packet.data)
      return null;

    if (_.isArray(packet.data)) {
      // @ts-ignore
      return await Promise.mapSeries(packet.data, async (item: EntryModel) => {
        const newPacket = _.cloneDeep(packet);
        newPacket.data = item;
        return await this.append(newPacket);
      });
    }

    let reply = null;

    const lastInfo = await this.mokka.getDb().getState().getInfo();

    if (packet.data.index > lastInfo.index + 1)
      return null;

    if (lastInfo.index === packet.data.index) {

      const record = await this.mokka.getDb().getEntry().get(packet.data.index);

      if (record && record.hash === packet.data.hash) {
        reply = await this.messageApi.packet(messageTypes.APPEND_ACK, {
          index: packet.data.index,
          term: packet.data.term
        });

        return new ReplyModel(reply, packet.publicKey);
      }
    }

    if (lastInfo.index >= packet.data.index)
      return null;

    try {

      if (!packet.data.responses.includes(this.mokka.publicKey))
        packet.data.responses.push(this.mokka.publicKey);

      await this.mokka.getDb().getLog().save(
        packet.data.log,
        packet.data.term,
        packet.data.signature,
        packet.data.responses,
        packet.data.index,
        packet.data.hash
      );

      const hash = crypto.createHmac('sha256', JSON.stringify(packet.data.log)).digest('hex');
      await this.mokka.gossip.pullPending(hash);
      this.mokka.logger.info(`the ${packet.data.index} has been saved`);
    } catch (err) {
      this.mokka.logger.error(`error during save log: ${JSON.stringify(err)}`);

      if (err.code === 2 || err.code === 3)
        return;

      reply = await this.messageApi.packet(messageTypes.APPEND_FAIL, {index: lastInfo.index});
      return new ReplyModel(reply, states.LEADER);
    }

    reply = await this.messageApi.packet(messageTypes.APPEND_ACK);

    return new ReplyModel(reply, packet.publicKey);
  }

  public async appendAck(packet: PacketModel) {

    let entry = await this.mokka.getDb().getEntry().get(packet.last.index);

    const isEqual = !entry ? false : _.isEqual(_.sortBy(packet.last.responses), _.sortBy(entry.responses));
    const includesAllResponses = !entry ? false : _.chain(packet.last.responses)
      .reject((item: string) => entry.responses.includes(item))
      .size()
      .eq(0)
      .value();

    if (!entry || isEqual || includesAllResponses)
      return;

    entry = await this.mokka.getDb().getLog().ack(
      packet.last.index,
      packet.last.responses
    );

    this.mokka.logger.info(`append ack: ${packet.last.index} / ${entry.responses.length}`);

    const info = await this.mokka.getDb().getState().getInfo();

    if (this.mokka.quorum(entry.responses.length) && info.committedIndex < entry.index) {
      const entries = await this.mokka.getDb().getEntry().getAfterList(
        info.committedIndex,
        entry.index - info.committedIndex
      );

      for (const entry of entries) {
        await this.mokka.applier(
          entry.log,
          this.mokka.getDb().getState().getApplierFuncs(entry.index, entry.hash, entry.term)
        );

        await this.mokka.getDb().getLog().commit(entry.index);
      }
    }

    if (this.mokka.state !== states.LEADER)
      return;


    const reply = await this.messageApi.packet(messageTypes.APPEND_ACK);
    return new ReplyModel(reply, states.FOLLOWER);
  }

  public async obtain(packet: PacketModel, limit = 100): Promise<ReplyModel[]> {

    let entries = await this.mokka.getDb().getEntry().getAfterList(packet.last.index, limit);

    // @ts-ignore
    entries = _.groupBy(entries, 'term');
    const replies = [];

    for (const term of Object.keys(entries)) {
      const reply = await this.messageApi.packet(messageTypes.APPEND, entries[parseInt(term, 10)]);
      replies.push(new ReplyModel(reply, packet.publicKey));
    }

    return replies;
  }

  public async appendFail(packet: PacketModel): Promise<ReplyModel> {

    const lastInfo = await this.mokka.getDb().getState().getInfo();

    if (packet.data.index > lastInfo.index) {
      const reply = await this.messageApi.packet(messageTypes.ERROR, 'wrong index!');
      return new ReplyModel(reply, packet.publicKey);
    }

    const entity = await this.mokka.getDb().getEntry().get(packet.data.index);
    const reply = await this.messageApi.packet(messageTypes.APPEND, entity);
    return new ReplyModel(reply, packet.publicKey);
  }

}

export {AppendApi};
