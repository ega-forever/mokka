import {GossipApi} from '../api/GossipApi';
import messageTypes from '../constants/MessageTypes';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {ReplyModel} from '../models/ReplyModel';
import {AbstractRequestService} from './AbstractRequestService';

class GossipRequestProcessorService extends AbstractRequestService {

  private _gossipApi: GossipApi;

  constructor(mokka: Mokka) {
    super(mokka);
    this._gossipApi = new GossipApi(mokka);
  }

  protected async _process(packet: PacketModel): Promise<ReplyModel[] | ReplyModel | null> {

    let reply = null;

    if (packet.type === messageTypes.GOSSIP_REQUEST)
      reply = await this._gossipApi.request(packet);

    if (packet.type === messageTypes.GOSSIP_FIRST_RESPONSE)
      reply = await this._gossipApi.firstResponse(packet);

    if (packet.type === messageTypes.GOSSIP_SECOND_RESPONSE)
      reply = await this._gossipApi.secondResponse(packet);

    return reply;

  }

}

export {GossipRequestProcessorService};
