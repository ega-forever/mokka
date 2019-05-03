import isArray from 'lodash/isArray';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {PacketModel} from '../models/PacketModel';
import encodePacket from '../utils/encodePacket';

class MessageApi {

  private mokka: Mokka;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
  }

  public async message(who: number | string | string[], what: PacketModel) {

    const nodes: NodeModel[] = [];

    switch (who) {
      case states.LEADER:
        for (const node of this.mokka.nodes)
          if (this.mokka.leaderPublicKey === node.publicKey)
            nodes.push(node);

        break;

      case states.FOLLOWER:
        for (const node of this.mokka.nodes)
          if (this.mokka.leaderPublicKey !== node.publicKey)
            nodes.push(node);

        break;

      case states.CHILD:
        Array.prototype.push.apply(nodes, this.mokka.nodes);
        break;

      default:
        for (const node of this.mokka.nodes)
          if ((isArray(who) && who.includes(node.publicKey)) || who === node.publicKey)
            nodes.push(node);

    }

    for (const client of nodes)
      await client.write(client.address, encodePacket(what));

  }

  public async packet(type: number, data: any = null) {
    const last = await this.mokka.getDb().getState().getInfo();
    const entry = await this.mokka.getDb().getEntry().get(last.index);
    const responses = entry ? entry.responses : [this.mokka.publicKey];
    return new PacketModel(
      type,
      this.mokka.state,
      this.mokka.term,
      this.mokka.publicKey,
      {...last, responses},
      this.mokka.proof,
      data
    );
  }
}

export {MessageApi};
