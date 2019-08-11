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

      await this.mokka.getDb().getLog().save( // todo cause issue because of concurrency (wrong order)
        this.mokka.publicKey,
        packet.data.log,
        packet.data.term,
        packet.data.signature,
        packet.data.index,
        packet.data.hash
      );

      this.mokka.setLastLogIndex(packet.data.index);

      const hash = createHmac('sha256', JSON.stringify(packet.data.log)).digest('hex');
      await this.mokka.gossip.pullPending(hash);
      this.mokka.logger.info(`the ${packet.data.index} has been saved`);
      this.mokka.emit(eventTypes.LOG, packet.data.index);
    } catch (err) {
      console.log(err);
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

  public async appendAck(packet: PacketModel): Promise<PacketModel[]> {

    const node = this.mokka.nodes.find((node) => node.publicKey === packet.publicKey);

    if (!node)
      return [];

    if (packet.last.index > 0) {
      const entry = await this.mokka.getDb().getEntry().get(packet.last.index);

      if (!entry)
        return [];
    }

    await this.mokka.getDb().getState().setState(
      packet.publicKey,
      new StateModel(
        packet.last.index,
        packet.last.hash,
        packet.last.term,
        packet.last.createdAt
      )
    );
    node.setLastLogIndex(packet.last.index);

    this.mokka.logger.info(`append ack: ${packet.last.index} from ${packet.publicKey}`);

    return [];
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
