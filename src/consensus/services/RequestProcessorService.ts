import * as utils from '../../proof/cryptoUtils';
import {VoteApi} from '../api/VoteApi';
import eventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {PacketModel} from '../models/PacketModel';
import {AbstractRequestService} from './AbstractRequestService';

class RequestProcessorService extends AbstractRequestService {

  private voteApi: VoteApi;

  constructor(mokka: Mokka) {
    super(mokka);
    this.voteApi = new VoteApi(mokka);
  }

  protected async _process(packet: PacketModel, node: NodeModel): Promise<PacketModel[]> {

    let replies: PacketModel[] = [];

    if (
      packet.state === states.LEADER &&
      this.mokka.proof === packet.proof &&
      this.mokka.getProofMintedTime() + this.mokka.proofExpiration < Date.now()
    ) {
      return replies;
    }

    if (states.LEADER !== this.mokka.state && packet.state === states.LEADER) {
      this.mokka.heartbeatCtrl.setNextBeat(this.mokka.election.max);
    }

    if (packet.state === states.LEADER && this.mokka.proof !== packet.proof) {

      const splittedPoof = packet.proof.split(':');
      const isValid = utils.verify(packet.term, parseInt(splittedPoof[0], 10), splittedPoof[1], splittedPoof[2]);

      if (!isValid) {
        return [this.messageApi.packet(messageTypes.ERROR, 'validation failed')];
      }

      this.mokka.setState(states.FOLLOWER, packet.term, packet.publicKey, packet.proof, parseInt(splittedPoof[0], 10));
    }

    if (packet.type === messageTypes.VOTE)
      replies = await this.voteApi.vote(packet);

    if (packet.type === messageTypes.VOTED)
      await this.voteApi.voted(packet);

    if (packet.type === messageTypes.ERROR)
      this.mokka.emit(eventTypes.ERROR, packet.data);

    if (!Object.values(messageTypes).includes(packet.type)) {
      replies = [
        this.messageApi.packet(messageTypes.ERROR, 'Unknown message type: ' + packet.type)
      ];
    }

    if (this.mokka.state !== states.LEADER && packet.state === states.LEADER) {
      this.mokka.heartbeatCtrl.setNextBeat(this.mokka.heartbeatCtrl.timeout());
    }

    return replies;
  }

}

export {RequestProcessorService};
