import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';

class MessageApi {

  private mokka: Mokka;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
  }

  public async message(packet: PacketModel, peerPublicKey: string) {
    const node = this.mokka.nodes.get(peerPublicKey);
    await node.write(node.address, Buffer.from(JSON.stringify(packet)));
  }

  public packet(type: number, data: any = null): PacketModel {
    return new PacketModel(
      type,
      this.mokka.state,
      this.mokka.term,
      this.mokka.publicKey,
      this.mokka.proof,
      data);
  }

}

export {MessageApi};
