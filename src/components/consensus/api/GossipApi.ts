import messageTypes from '../constants/MessageTypes';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {ReplyModel} from '../models/ReplyModel';
import {MessageApi} from './MessageApi';

class GossipApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async request(packet: PacketModel): Promise<ReplyModel> {

    const sc = this.mokka.gossip.scuttle.scuttle(packet.data.digest);
    this.mokka.gossip.handleNewPeers(sc.newPeers);

    const data = {
      requestDigest: sc.requests,
      updates: sc.deltas
    };

    const reply = await this.messageApi.packet(messageTypes.GOSSIP_FIRST_RESPONSE, data);
    return new ReplyModel(reply, packet.publicKey);
  }

  public async firstResponse(packet: PacketModel): Promise<ReplyModel> {

    await this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);
    const updates = await this.mokka.gossip.scuttle.fetchDeltas(packet.data.requestDigest);

    const data = {
      updates
    };

    const reply = await this.messageApi.packet(messageTypes.GOSSIP_SECOND_RESPONSE, data);
    return new ReplyModel(reply, packet.publicKey);
  }

  public async secondResponse(packet: PacketModel): Promise<null> {
    await this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);
    return null;
  }

}

export {GossipApi};
