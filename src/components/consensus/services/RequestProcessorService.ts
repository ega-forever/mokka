import {AppendApi} from '../api/AppendApi';
import {VoteApi} from '../api/VoteApi';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {PacketModel} from '../models/PacketModel';
import {ReplyModel} from '../models/ReplyModel';
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

  public async _process(packet: PacketModel): Promise<ReplyModel[] | ReplyModel | null> {

    if (packet == null)
      return null;

    let reply = null;

    this.mokka.timer.heartbeat(states.LEADER === this.mokka.state ? this.mokka.heartbeat : this.mokka.timer.timeout());

    if (packet.state === states.LEADER && this.mokka.proof !== packet.proof) {

      const pubKeys = this.mokka.nodes.map((node: NodeModel) => node.publicKey);
      pubKeys.push(this.mokka.publicKey);
      const validated = validate(packet.term, packet.proof, this.mokka.proof, pubKeys);

      if (!validated) {
        const reply = await this.messageApi.packet(messageTypes.ERROR, 'validation failed');
        return new ReplyModel(reply, packet.publicKey);
      }

      this.mokka.setState(states.FOLLOWER, packet.term, packet.publicKey, packet.proof);
      this.mokka.timer.clearElectionTimeout();
    }

    const lastInfo = await this.mokka.getDb().getState().getInfo();

    if (packet.type === messageTypes.VOTE)
      reply = await this.voteApi.vote(packet);

    if (packet.type === messageTypes.VOTED)
      reply = await this.voteApi.voted(packet);

    if (packet.type === messageTypes.ERROR)
      this.mokka.emit('error', new Error(packet.data));

    if (packet.type === messageTypes.APPEND)
      reply = await this.appendApi.append(packet);

    if (packet.type === messageTypes.APPEND_ACK)
      reply = await this.appendApi.appendAck(packet);

    if (packet.type === messageTypes.APPEND_FAIL)
      reply = await this.appendApi.appendFail(packet);

    if (packet.type === messageTypes.RE_APPEND)
      reply = await this.appendApi.obtain(packet);

    if (!Object.values(messageTypes).includes(packet.type)) {
      const response = await this.messageApi.packet(messageTypes.ERROR, 'Unknown message type: ' + packet.type);
      reply = new ReplyModel(response, packet.publicKey);
    }

    this.mokka.timer.heartbeat(states.LEADER === this.mokka.state ? this.mokka.heartbeat : this.mokka.timer.timeout());

    if (packet.state === states.LEADER &&
      lastInfo.index > 0 &&
      packet.last.index === lastInfo.index &&
      !packet.last.responses.includes(this.mokka.publicKey)) {
      const response = await this.messageApi.packet(messageTypes.APPEND_ACK);
      reply = new ReplyModel(response, packet.publicKey);
    }

    if (!reply &&
      this.mokka.state !== states.LEADER &&
      packet.type === messageTypes.ACK &&
      packet.last && packet.last.index > lastInfo.index &&
      packet.last.createdAt < Date.now() - this.mokka.heartbeat) {

      const response = await this.messageApi.packet(messageTypes.RE_APPEND);
      reply = new ReplyModel(response, packet.publicKey);
    }

    return reply;
  }

}

export {RequestProcessorService};
