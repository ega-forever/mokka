import {MessageApi} from '../api/MessageApi';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';

class AbstractRequestService {

  protected mokka: Mokka;
  protected messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async process(packet: PacketModel) {

    this.mokka.emit(`${packet.publicKey}:${packet.type}`, packet.data);

    const data: PacketModel[] = await this._process(packet);

    for (const item of data)
      await this.messageApi.message(item);
  }

  protected async _process(packet: PacketModel): Promise<PacketModel[]> {
    throw new Error('process should be implemented');
  }

}

export {AbstractRequestService};
