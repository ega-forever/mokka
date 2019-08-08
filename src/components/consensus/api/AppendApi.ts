import {createHmac} from 'crypto';
import eventTypes from '../../shared/constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {MessageApi} from './MessageApi';

class AppendApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async append(packet: PacketModel): Promise<PacketModel[]> {

    if (!packet.data)
      return [];

    const replies: PacketModel[] = [];

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
          reply = await this.messageApi.packet(messageTypes.APPEND_ACK, packet.publicKey, {
            index: data.index,
            term: data.term
          });

          replies.push(reply);
          continue;
        }
      }

      if (lastInfo.index >= data.index)
        return null;

      try {

        if (!data.responses.includes(this.mokka.publicKey))
          data.responses.push(this.mokka.publicKey);

        await this.mokka.getDb().getLog().save( // todo cause issue because of concurrency (wrong order)
          data.log,
          data.term,
          data.signature,
          data.responses,
          data.index,
          data.hash
        );

        this.mokka.setLastLogIndex(data.index);

        const hash = createHmac('sha256', JSON.stringify(data.log)).digest('hex');
        await this.mokka.gossip.pullPending(hash);
        this.mokka.logger.info(`the ${data.index} has been saved`);
        this.mokka.emit(eventTypes.LOG, data.index);
      } catch (err) {
        this.mokka.logger.error(`error during save log: ${JSON.stringify(err)}`);

        if (err.code === 2 || err.code === 3)
          return;

        reply = await this.messageApi.packet(messageTypes.APPEND_FAIL, packet.publicKey, {index: lastInfo.index});
        replies.push(reply);
        return replies;
      }

      reply = await this.messageApi.packet(messageTypes.APPEND_ACK, packet.publicKey);
      replies.push(reply);
    }

    return replies;
  }

  public async appendAck(packet: PacketModel): Promise<PacketModel[]> {

    let entry = await this.mokka.getDb().getEntry().get(packet.last.index);

    if (!entry)
      return [];

    const node = this.mokka.nodes.find((node) => node.publicKey === packet.publicKey);

    if (!node)
      return [];

    node.setLastLogIndex(packet.last.index);

    const newResponses = packet.last.responses
      .filter((item: string) => !entry.responses.includes(item));

    if (!newResponses.length)
      return [];

    entry = await this.mokka.getDb().getLog().ack(
      packet.last.index,
      newResponses
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
      return [];

    const replies: PacketModel[] = [];

    for (const node of this.mokka.nodes) {
      const reply = await this.messageApi.packet(messageTypes.APPEND_ACK, node.publicKey); // todo send to all followers
      replies.push(reply);
    }

    return replies;
  }

  public async appendFail(packet: PacketModel): Promise<PacketModel[]> {

    const lastInfo = await this.mokka.getDb().getState().getInfo();

    if (packet.data.index > lastInfo.index) {
      return [await this.messageApi.packet(messageTypes.ERROR, packet.publicKey, 'wrong index!')];
    }

    const entity = await this.mokka.getDb().getEntry().get(packet.data.index);
    return [await this.messageApi.packet(messageTypes.APPEND, packet.publicKey, entity)];
  }

}

export {AppendApi};
