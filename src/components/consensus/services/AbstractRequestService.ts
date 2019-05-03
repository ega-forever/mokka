import has from 'lodash/has';
import isArray from 'lodash/isArray';
import {Semaphore} from 'semaphore';
import semaphore = require('semaphore');
import {MessageApi} from '../api/MessageApi';
import messageTypes from '../constants/MessageTypes';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {ReplyModel} from '../models/ReplyModel';

class AbstractRequestService {

  protected mokka: Mokka;
  protected semaphore: Semaphore;
  protected messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.semaphore = semaphore(1);
    this.messageApi = new MessageApi(mokka);
  }

  public async process(packet: PacketModel) {

    const data: ReplyModel[] | ReplyModel =
      packet.type === messageTypes.ACK ?
        await this._process(packet) :
        await new Promise((res) => {
          this.semaphore.take(async () => {
            const data = await this._process(packet);
            res(data || null);
            this.semaphore.leave();
          });
        });

    if (!has(data, 'who') && !has(data, '0.who'))
      return;

    if (isArray(data)) {
      for (const item of data)
        await this.messageApi.message(item.who, item.reply);

      return;
    }

    await this.messageApi.message(data.who, data.reply);
  }

  public async _process(packet: PacketModel): Promise<ReplyModel[] | ReplyModel | null> {
    throw new Error('process should be implemented');
  }

}

export {AbstractRequestService};
