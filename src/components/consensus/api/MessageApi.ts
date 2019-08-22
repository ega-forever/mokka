import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';

class MessageApi {

  private mokka: Mokka;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
  }

  public async message(packet: PacketModel) {

    const node = this.mokka.nodes.get(packet.peer.publicKey);

    await node.write(node.address, Buffer.from(JSON.stringify(packet)));
  }

  // todo encrypt message with public key of follower
  public async packet(type: number, publicKey: string, data: any = null): Promise<PacketModel> {
    const last = this.mokka.getLastLogState();
    const peerNode = this.mokka.nodes.get(publicKey);

    return new PacketModel(
      type,
      this.mokka.state,
      this.mokka.term,
      this.mokka.publicKey,
      last,
      this.mokka.proof,
      {
        number: peerNode.getLastLogState().index,
        publicKey
      },
      data);
  }

}

export {MessageApi};
