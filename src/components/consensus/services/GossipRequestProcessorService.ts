import {GossipApi} from '../api/GossipApi';
import messageTypes from '../constants/MessageTypes';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {AbstractRequestService} from './AbstractRequestService';

class GossipRequestProcessorService extends AbstractRequestService {

  private _gossipApi: GossipApi;

  constructor(mokka: Mokka) {
    super(mokka);
    this._gossipApi = new GossipApi(mokka);
  }

  protected async _process(packet: PacketModel): Promise<PacketModel[]> {

    let replies: PacketModel[] = [];

    if (packet.type === messageTypes.GOSSIP_REQUEST)
      replies = [await this._gossipApi.request(packet)];

    if (packet.type === messageTypes.GOSSIP_FIRST_RESPONSE)
      replies = [await this._gossipApi.firstResponse(packet)];

    if (packet.type === messageTypes.GOSSIP_SECOND_RESPONSE)
      await this._gossipApi.secondResponse(packet);

    return replies;

  }

}

export {GossipRequestProcessorService};
