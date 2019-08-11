import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';

class MessageApi {

  private mokka: Mokka;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
  }

  public async message(packet: PacketModel) {

    const node = this.mokka.nodes.find(
      (node) => node.publicKey === packet.peer.publicKey
    );

    if (node.getLastLogIndex() !== -1)
      await node.write(node.address, Buffer.from(JSON.stringify(packet)));

  }

  public async packet(type: number, publicKey: string, data: any = null): Promise<PacketModel> { // todo encrypt message with public key of follower
    const last = await this.mokka.getDb().getState().getInfo(this.mokka.publicKey);
    const peerNode = this.mokka.nodes.find((node) => node.publicKey === publicKey);

    return new PacketModel(
      type,
      this.mokka.state,
      this.mokka.term,
      this.mokka.publicKey,
      last,
      this.mokka.proof,
      {
        number: peerNode.getLastLogIndex(),
        publicKey
      },
      data);
  }
}

export {MessageApi};
