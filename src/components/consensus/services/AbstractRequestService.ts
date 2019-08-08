import semaphore, {Semaphore} from 'semaphore';
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

    this.mokka.emit(`${packet.publicKey}:${packet.type}`, packet.data);

    const data: PacketModel[] =
      packet.type === messageTypes.ACK ?
        await this._process(packet) :
        await new Promise((res) => {
          this.semaphore.take(async () => {
            const data = await this._process(packet);
            res(data);
            this.semaphore.leave();
          });
        });

    for (const item of data)
      await this.messageApi.message(item);
  }

  protected async _process(packet: PacketModel): Promise<PacketModel[]> {
    throw new Error('process should be implemented');
  }

}

export {AbstractRequestService};
