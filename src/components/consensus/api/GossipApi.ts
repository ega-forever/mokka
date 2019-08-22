import messageTypes from '../constants/MessageTypes';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {MessageApi} from './MessageApi';

class GossipApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async request(packet: PacketModel): Promise<PacketModel> {

    const sc = this.mokka.gossip.scuttle.scuttle(packet.data.digest);
    this.mokka.gossip.handleNewPeers(sc.newPeers);

    const data = {
      requestDigest: sc.requests,
      updates: sc.deltas
    };

    return await this.messageApi.packet(messageTypes.GOSSIP_FIRST_RESPONSE, packet.publicKey, data);
  }

  public async firstResponse(packet: PacketModel): Promise<PacketModel> {

    await this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);
    const updates = await this.mokka.gossip.scuttle.fetchDeltas(packet.data.requestDigest);

    const data = {
      updates
    };

    return await this.messageApi.packet(messageTypes.GOSSIP_SECOND_RESPONSE, packet.publicKey, data);
  }

  public async secondResponse(packet: PacketModel): Promise<void> {
    await this.mokka.gossip.scuttle.updateKnownState(packet.data.updates);
  }

}

export {GossipApi};
