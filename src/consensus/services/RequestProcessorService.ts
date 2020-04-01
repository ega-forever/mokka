import {MessageApi} from '../api/MessageApi';
import {VoteApi} from '../api/VoteApi';
import eventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import * as utils from '../utils/cryptoUtils';

class RequestProcessorService {

  private voteApi: VoteApi;
  private mokka: Mokka;
  private messageApi: MessageApi;

  private readonly actionMap: Map<number, (packet: PacketModel) => Promise<PacketModel>>;

  constructor(mokka: Mokka) {
    this.voteApi = new VoteApi(mokka);
    this.messageApi = new MessageApi(mokka);
    this.mokka = mokka;
    this.actionMap = new Map<number, (packet: PacketModel) => Promise<PacketModel>>();

    // todo may be introduce middleware for each action
    this.actionMap.set(messageTypes.VOTE, this.voteApi.vote.bind(this.voteApi));
    this.actionMap.set(messageTypes.VOTED, this.voteApi.voted.bind(this.voteApi));
    this.actionMap.set(messageTypes.ACK, (packet: PacketModel) => {
      if (this.mokka.state !== states.LEADER && packet.state === states.LEADER) {
        this.mokka.heartbeatCtrl.setNextBeat(this.mokka.heartbeatCtrl.timeout());
      }
      return null;
    });
    this.actionMap.set(messageTypes.ERROR, (packet: PacketModel) => {
      this.mokka.emit(eventTypes.ERROR, packet.data);
      return null;
    });
    // todo set map for ack and error
  }

  public async process(packet: PacketModel) {

    const node = this.mokka.nodes.get(packet.publicKey);

    if (!node || !this.actionMap.has(packet.type))
      return;

    if (!this.validateAuth(packet)) {
      return;
    }

    this.mokka.emit(`${packet.publicKey}:${packet.type}`, packet.data);

    const data: PacketModel | null = await this.actionMap.get(packet.type)(packet);

    if (data)
      await this.messageApi.message(data, packet.publicKey);
  }

  private validateAuth(packet: PacketModel): boolean {

    if (
      packet.state === states.LEADER &&
      this.mokka.proof === packet.proof &&
      this.mokka.getProofMintedTime() + this.mokka.proofExpiration < Date.now()
    ) {
      this.mokka.setState(this.mokka.state, this.mokka.term, this.mokka.leaderPublicKey);
      return false;
    }

    if (packet.state === states.LEADER && this.mokka.proof !== packet.proof) {

      const splittedPoof = packet.proof.split(':');
      const isValid = utils.verify(packet.term, parseInt(splittedPoof[0], 10), splittedPoof[1], splittedPoof[2]);

      if (!isValid) {
        return false;
      }

      this.mokka.setState(states.FOLLOWER, packet.term, packet.publicKey, packet.proof, parseInt(splittedPoof[0], 10));
      return true;
    }

    return true;
  }

}

export {RequestProcessorService};
