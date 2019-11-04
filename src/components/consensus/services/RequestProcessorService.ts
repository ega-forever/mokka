import eventTypes from '../../shared/constants/EventTypes';
import {AppendApi} from '../api/AppendApi';
import {VoteApi} from '../api/VoteApi';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {PacketModel} from '../models/PacketModel';
import {validate} from '../utils/proofValidation';
import {AbstractRequestService} from './AbstractRequestService';

class RequestProcessorService extends AbstractRequestService {

  private voteApi: VoteApi;
  private appendApi: AppendApi;

  constructor(mokka: Mokka) {
    super(mokka);
    this.voteApi = new VoteApi(mokka);
    this.appendApi = new AppendApi(mokka);
  }

  protected async _process(packet: PacketModel, node: NodeModel): Promise<PacketModel[]> {

    let replies: PacketModel[] = [];

    if (
      packet.state === states.LEADER &&
      this.mokka.proof === packet.proof &&
      this.mokka.proofExpiration &&
      this.mokka.getProofMintedTime() + this.mokka.proofExpiration < Date.now()
    ) {
      return replies;
    }

    if (states.LEADER !== this.mokka.state && packet.state === states.LEADER) {
      this.mokka.timer.clearHeartbeatTimeout();
    }

    if (packet.state === states.LEADER && this.mokka.proof !== packet.proof) {

      const rawPubKeysMap = new Map<string, string>();

      for (const node of this.mokka.nodes.values()) {
        rawPubKeysMap.set(node.rawPublicKey, node.publicKey);
      }

      const {validated, minted} = validate(packet.term, packet.proof, rawPubKeysMap, packet.publicKey);

      if (!validated) {
        return [await this.messageApi.packet(messageTypes.ERROR, packet.publicKey, 'validation failed')];
      }

      this.mokka.setState(states.FOLLOWER, packet.term, packet.publicKey, packet.proof, minted);
    }

    if (packet.type === messageTypes.APPEND_ACK)
      await this.appendApi.appendAck(packet);

    if (packet.type === messageTypes.VOTE)
      replies = await this.voteApi.vote(packet);

    if (packet.type === messageTypes.VOTED)
      await this.voteApi.voted(packet);

    if (packet.type === messageTypes.ERROR)
      this.mokka.emit(eventTypes.ERROR, packet.data);

    if (packet.type === messageTypes.APPEND)
      replies = await this.appendApi.append(packet);

    if (packet.type === messageTypes.APPEND_FAIL)
      replies = await this.appendApi.appendFail(packet);

    if (!Object.values(messageTypes).includes(packet.type)) {
      replies = [
        await this.messageApi.packet(messageTypes.ERROR, packet.publicKey, 'Unknown message type: ' + packet.type)
      ];
    }

    if (this.mokka.state !== states.LEADER && packet.state === states.LEADER) {
      this.mokka.timer.heartbeat(this.mokka.timer.timeout());
    }

    return replies;
  }

}

export {RequestProcessorService};
