import {createHmac} from 'crypto';
import eventTypes from '../../shared/constants/EventTypes';
import {StateModel} from '../../storage/models/StateModel';
import messageTypes from '../constants/MessageTypes';
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

    const lastInfo = await this.mokka.getDb().getState().getInfo(this.mokka.publicKey);

    if (packet.data.index > lastInfo.index + 1)
      return replies;

    if (lastInfo.index === packet.data.index) {

      const record = await this.mokka.getDb().getEntry().get(packet.data.index);

      if (record && record.hash === packet.data.hash) {
        const reply = await this.messageApi.packet(messageTypes.APPEND_ACK, packet.publicKey, {
          index: packet.data.index,
          term: packet.data.term
        });

        replies.push(reply);
        return replies;
      }
    }

    if (lastInfo.index >= packet.data.index)
      return [];

    try {

      const entry = await this.mokka.getDb().getLog().save( // todo cause issue because of concurrency (wrong order)
        this.mokka.publicKey,
        packet.data.log,
        packet.data.term,
        packet.data.signature,
        packet.data.index,
        packet.data.hash
      );

      this.mokka.setLastLogState({
        createdAt: entry.createdAt,
        hash: entry.hash,
        index: entry.index,
        term: entry.term
      });

      const hash = createHmac('sha256', JSON.stringify(packet.data.log)).digest('hex');
      await this.mokka.gossip.pullPending(hash);
      this.mokka.logger.info(`the ${packet.data.index} has been saved`);
      this.mokka.emit(eventTypes.LOG, packet.data.index);
    } catch (err) {
      this.mokka.logger.error(`error during save log: ${JSON.stringify(err)}`);

      if (err.code === 2 || err.code === 3)
        return [];

      const reply = await this.messageApi.packet(messageTypes.APPEND_FAIL, packet.publicKey, {index: lastInfo.index});
      replies.push(reply);
      return replies;
    }

    const reply = await this.messageApi.packet(messageTypes.APPEND_ACK, packet.publicKey);
    replies.push(reply);

    return replies;
  }

  public async appendAck(packet: PacketModel): Promise<void> {

    const node = this.mokka.nodes.get(packet.publicKey);

    if (!node)
      return;

    if (packet.last.index > 0) {
      const entry = await this.mokka.getDb().getEntry().get(packet.last.index);

      if (!entry)
        return;
    }

    const committedIndex = this.mokka.committedIndex();

    const state = new StateModel(
      packet.last.index,
      packet.last.hash,
      packet.last.term,
      packet.last.createdAt
    );

    await this.mokka.getDb().getState().setState(packet.publicKey, state);
    node.setLastLogState(state);

    this.mokka.logger.info(`append ack: ${packet.last.index} from ${packet.publicKey}`);
    // todo send event
    if (committedIndex !== this.mokka.committedIndex())
      this.mokka.emit(eventTypes.COMMITTED);

  }

  public async appendFail(packet: PacketModel): Promise<PacketModel[]> {

    const lastInfo = await this.mokka.getDb().getState().getInfo(this.mokka.publicKey);

    if (packet.data.index > lastInfo.index) {
      return [await this.messageApi.packet(messageTypes.ERROR, packet.publicKey, 'wrong index!')];
    }

    const entity = await this.mokka.getDb().getEntry().get(packet.data.index);
    return [await this.messageApi.packet(messageTypes.APPEND, packet.publicKey, entity)];
  }

}

export {AppendApi};
