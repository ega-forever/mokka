import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';

class MessageApi {

  private mokka: Mokka;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
  }

  public async message(packet: PacketModel, peerPublicKey: string) {
    packet = await this.mokka.resMiddleware(packet, peerPublicKey);
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

  public decodePacket(message: Buffer): PacketModel {
    return JSON.parse(message.toString());
  }

}

export {MessageApi};
