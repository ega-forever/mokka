import {createHmac} from 'crypto';
import groupBy from 'lodash/groupBy';
import isEqual from 'lodash/isEqual';
import sortBy from 'lodash/sortBy';
import eventTypes from '../../shared/constants/EventTypes';
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

  public async append(packet: PacketModel): Promise<ReplyModel[]> {

    if (!packet.data)
      return [];

    const replies: ReplyModel[] = [];

    if (!Array.isArray(packet.data)) {
      packet.data = [packet.data];
    }

    for (const data of packet.data) {
      let reply = null;

      const lastInfo = await this.mokka.getDb().getState().getInfo();

      if (data.index > lastInfo.index + 1)
        return replies;

      if (lastInfo.index === data.index) {

        const record = await this.mokka.getDb().getEntry().get(data.index);

        if (record && record.hash === data.hash) {
          reply = await this.messageApi.packet(messageTypes.APPEND_ACK, {
            index: data.index,
            term: data.term
          });

          replies.push(new ReplyModel(reply, packet.publicKey));
          continue;
        }
      }

      if (lastInfo.index >= data.index)
        return null;

      try {

        if (!data.responses.includes(this.mokka.publicKey))
          data.responses.push(this.mokka.publicKey);

        await this.mokka.getDb().getLog().save(
          data.log,
          data.term,
          data.signature,
          data.responses,
          data.index,
          data.hash
        );

        const hash = createHmac('sha256', JSON.stringify(data.log)).digest('hex');
        await this.mokka.gossip.pullPending(hash);
        this.mokka.logger.info(`the ${data.index} has been saved`);
        this.mokka.emit(eventTypes.LOG, data.index);
      } catch (err) {
        this.mokka.logger.error(`error during save log: ${JSON.stringify(err)}`);

        if (err.code === 2 || err.code === 3)
          return;

        reply = await this.messageApi.packet(messageTypes.APPEND_FAIL, {index: lastInfo.index});
        replies.push(new ReplyModel(reply, states.LEADER));
        return replies;
      }

      reply = await this.messageApi.packet(messageTypes.APPEND_ACK);
      replies.push(new ReplyModel(reply, packet.publicKey));
    }

    return replies;
  }

  public async appendAck(packet: PacketModel) {

    let entry = await this.mokka.getDb().getEntry().get(packet.last.index);

    const isEqualResponses = !entry ? false : isEqual(sortBy(packet.last.responses), sortBy(entry.responses));
    const includesAllResponses = !entry ? false : packet.last.responses
      .filter((item: string) => !entry.responses.includes(item))
      .length === 0;

    if (!entry || isEqualResponses || includesAllResponses)
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
        await this.mokka.getDb().getLog().commit(entry.index);
        this.mokka.emit(eventTypes.LOG_ACK, entry.index);
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
    entries = groupBy(entries, 'term');
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
