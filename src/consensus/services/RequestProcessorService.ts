import { MessageApi } from '../api/MessageApi';
import { NodeApi } from '../api/NodeApi';
import { VoteApi } from '../api/VoteApi';
import messageTypes from '../constants/MessageTypes';
import { Mokka } from '../main';
import { PacketModel } from '../models/PacketModel';

class RequestProcessorService {

  private voteApi: VoteApi;
  private mokka: Mokka;
  private messageApi: MessageApi;
  private nodeApi: NodeApi;

  private readonly actionMap: Map<number, ((packet: PacketModel) => Promise<PacketModel>)[]>;

  constructor(mokka: Mokka) {
    this.voteApi = new VoteApi(mokka);
    this.messageApi = new MessageApi(mokka);
    this.nodeApi = new NodeApi(mokka);
    this.mokka = mokka;
    this.actionMap = new Map<number, ((packet: PacketModel) => Promise<PacketModel>)[]>();

    this.actionMap.set(messageTypes.VOTE, [
      this.voteApi.vote.bind(this.voteApi)
    ]);

    this.actionMap.set(messageTypes.VOTED, [
      this.voteApi.voted.bind(this.voteApi)
    ]);

    this.actionMap.set(messageTypes.ACK, [
      this.voteApi.validateAndApplyLeader.bind(this.voteApi),
      this.nodeApi.pingFromLeader.bind(this.nodeApi)
    ]);
  }

  public async process(packet: PacketModel) {

    const node = this.mokka.nodes.get(packet.publicKey);

    if (!node || !this.actionMap.has(packet.type))
      return;

    let reply: PacketModel | null | false = false;

    for (const action of this.actionMap.get(packet.type)) {
      if (reply === null) {
        continue;
      }
      reply = await action(reply === false ? packet : reply);
    }

    if (reply)
      await this.messageApi.message(reply, packet.publicKey);
  }

}

export { RequestProcessorService };
