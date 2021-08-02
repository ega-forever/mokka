import {MessageApi} from './api/MessageApi';
import {NodeApi} from './api/NodeApi';
import {HeartbeatController} from './controllers/HeartbeatController';
import {ILoggerInterface} from './interfaces/ILoggerInterface';
import {ISettingsInterface} from './interfaces/ISettingsInterface';
import {NodeModel} from './models/NodeModel';
import {PacketModel} from './models/PacketModel';
import {VoteModel} from './models/VoteModel';
import {RequestProcessorService} from './services/RequestProcessorService';

class Mokka extends NodeModel {

  public heartbeat: number;
  public proofExpiration: number;
  public electionTimeout: number;
  public publicKeysRoot: string;
  public publicKeysCombinationsInQuorum: string[][];
  public readonly nodeApi: NodeApi;
  public readonly messageApi: MessageApi;
  public readonly heartbeatCtrl: HeartbeatController;
  public readonly reqMiddleware: (packet: PacketModel) => Promise<PacketModel>;
  public readonly resMiddleware: (packet: PacketModel, peerPublicKey: string) => Promise<PacketModel>;
  public readonly customVoteRule: (packet: PacketModel) => Promise<boolean>;
  public vote: VoteModel;
  public readonly logger: ILoggerInterface;
  private readonly requestProcessorService: RequestProcessorService;

  constructor(options: ISettingsInterface) {
    super(options.privateKey, options.address);

    this.heartbeat = options.heartbeat;
    this.electionTimeout = options.electionTimeout;
    this.proofExpiration = options.proofExpiration;
    this.logger = options.logger || {
      // tslint:disable-next-line
      error: console.log,
      // tslint:disable-next-line
      info: console.log,
      // tslint:disable-next-line
      trace: console.log
    };

    this.reqMiddleware = options.reqMiddleware ? options.reqMiddleware :
      async (packet: PacketModel) => packet;

    this.resMiddleware = options.resMiddleware ? options.resMiddleware :
      async (packet: PacketModel) => packet;

    this.customVoteRule = options.customVoteRule ? options.customVoteRule :
      async (packet: PacketModel) => true;

    this.heartbeatCtrl = new HeartbeatController(this);
    this.requestProcessorService = new RequestProcessorService(this);
    this.nodeApi = new NodeApi(this);
    this.messageApi = new MessageApi(this);
  }

  public quorum(responses: number) {
    if (!this.nodes.size || !responses) return false;

    return responses >= this.majority();
  }

  public setVote(vote: VoteModel): void {
    this.vote = vote;
  }

  public connect(): void {
    this.heartbeatCtrl.setNextBeat(this.heartbeatCtrl.timeout());
    this.heartbeatCtrl.watchBeat();
  }

  public async disconnect(): Promise<void> {
    await this.heartbeatCtrl.stopBeat();
  }

  public async emitPacket(packet: Buffer) {
    let parsedPacket = this.messageApi.decodePacket(packet);
    parsedPacket = await this.reqMiddleware(parsedPacket);
    await this.requestProcessorService.process(parsedPacket);
  }

}

export {Mokka};
