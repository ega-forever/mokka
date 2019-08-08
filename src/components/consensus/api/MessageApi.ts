import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
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
    const last = await this.mokka.getDb().getState().getInfo();
    const peerNode = this.mokka.nodes.find((node) => node.publicKey === publicKey);
    const entry = await this.mokka.getDb().getEntry().get(last.index);
    const responses = entry ? entry.responses : [this.mokka.publicKey];
    return new PacketModel(
      type,
      this.mokka.state,
      this.mokka.term,
      this.mokka.publicKey,
      {...last, responses},
      this.mokka.proof,
      {
        number: peerNode.getLastLogIndex(),
        publicKey
      },
      data);
  }
}

export {MessageApi};
