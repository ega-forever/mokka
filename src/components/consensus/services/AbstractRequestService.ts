import {MessageApi} from '../api/MessageApi';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {NodeModel} from '../models/NodeModel';

class AbstractRequestService {

  protected mokka: Mokka;
  protected messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async process(packet: PacketModel) {

    const node = this.mokka.nodes.get(packet.publicKey);

    if (!node)
      return;

    this.mokka.emit(`${packet.publicKey}:${packet.type}`, packet.data);

    const start = Date.now();
    const data: PacketModel[] = await this._process(packet, node);

    for (const item of data)
      await this.messageApi.message(item);

    const end = Date.now();


    if (end - start > 100) {
      console.log(`processed in ${end - start}`);
      console.log(packet);
      process.exit(0);
    }

  }

  protected async _process(packet: PacketModel, node: NodeModel): Promise<PacketModel[]> {
    throw new Error('process should be implemented');
  }

}

export {AbstractRequestService};
