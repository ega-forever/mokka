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
import {StateModel} from '../../storage/models/StateModel';

class RequestProcessorService extends AbstractRequestService {

  private voteApi: VoteApi;
  private appendApi: AppendApi;

  constructor(mokka: Mokka) {
    super(mokka);
    this.voteApi = new VoteApi(mokka);
    this.appendApi = new AppendApi(mokka);
  }

  protected async _process(packet: PacketModel): Promise<PacketModel[]> {

    let replies: PacketModel[] = [];

    if (states.LEADER !== this.mokka.state && packet.state === states.LEADER) {
      this.mokka.timer.clearHeartbeatTimeout();
    }

    if (packet.state === states.LEADER && this.mokka.proof !== packet.proof) {

      const pubKeys = this.mokka.nodes.map((node: NodeModel) => node.publicKey);
      pubKeys.push(this.mokka.publicKey);
      const validated = validate(packet.term, packet.proof, this.mokka.proof, pubKeys);

      if (!validated) {
        return [await this.messageApi.packet(messageTypes.ERROR, packet.publicKey, 'validation failed')];
      }

      this.mokka.setState(states.FOLLOWER, packet.term, packet.publicKey, packet.proof);
      await this.mokka.getDb().getState().setState(
        packet.publicKey,
        new StateModel(
          packet.last.index,
          packet.last.hash,
          packet.last.term,
          packet.last.createdAt
          )
      );
    }

    if (packet.state !== states.LEADER && this.mokka.state === states.LEADER) {
      const node = this.mokka.nodes.find((node) => node.publicKey === packet.publicKey);
      if (node.getLastLogIndex() !== packet.last.index) {
        node.setLastLogIndex(packet.last.index);
      }
    }

    if (packet.type === messageTypes.VOTE)
      replies = [await this.voteApi.vote(packet)];

    if (packet.type === messageTypes.VOTED)
      replies = await this.voteApi.voted(packet);

    if (packet.type === messageTypes.ERROR)
      this.mokka.emit(eventTypes.ERROR, new Error(packet.data));

    if (packet.type === messageTypes.APPEND)
      replies = await this.appendApi.append(packet);

    if (packet.type === messageTypes.APPEND_ACK) {
      replies = await this.appendApi.appendAck(packet);
    }

    if (packet.type === messageTypes.APPEND_FAIL)
      replies = await this.appendApi.appendFail(packet);

    if (!Object.values(messageTypes).includes(packet.type)) {
      replies = [
        await this.messageApi.packet(messageTypes.ERROR, packet.publicKey, 'Unknown message type: ' + packet.type)
      ];
    }

    if (packet.state === states.LEADER &&
      packet.type === messageTypes.ACK &&
      this.mokka.getLastLogIndex() !== packet.peer.number) {
      console.log(`asking to reappend ${this.mokka.getLastLogIndex()} vs ${packet.peer.number}`)
      replies = [await this.messageApi.packet(messageTypes.APPEND_ACK, packet.publicKey)];
    }

    if (this.mokka.state !== states.LEADER && packet.state === states.LEADER) {
      this.mokka.timer.heartbeat(this.mokka.timer.timeout());
    }

    return replies;
  }

}

export {RequestProcessorService};
