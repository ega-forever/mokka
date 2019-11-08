import {GossipController} from '../gossip/main';
import {MokkaStorage} from '../storage/main';
import {LogApi} from './api/LogApi';
import {NodeApi} from './api/NodeApi';
import messageTypes from './constants/MessageTypes';
import NodeStates from './constants/NodeStates';
import {HeartbeatController} from './controllers/HeartbeatController';
import {ILoggerInterface} from './interfaces/ILoggerInterface';
import {ISettingsInterface} from './interfaces/ISettingsInterface';
import {NodeModel} from './models/NodeModel';
import {VoteModel} from './models/VoteModel';
import {GossipRequestProcessorService} from './services/GossipRequestProcessorService';
import {RequestProcessorService} from './services/RequestProcessorService';

class Mokka extends NodeModel {

  public election: { min: number, max: number };
  public heartbeat: number;
  public proofExpiration: number;
  public gossip: GossipController;
  public readonly logger: ILoggerInterface;
  public vote: VoteModel = new VoteModel();
  public readonly heartbeatCtrl: HeartbeatController;
  public readonly logApi: LogApi;
  public readonly nodeApi: NodeApi;
  private readonly db: MokkaStorage;
  private readonly gossipRequestProcessorService: GossipRequestProcessorService;
  private readonly requestProcessorService: RequestProcessorService;

  constructor(options: ISettingsInterface) {
    super(options.privateKey, options.address);

    this.election = {
      max: options.electionMax || 300,
      min: options.electionMin || 150
    };

    this.heartbeat = options.heartbeat || 50;
    this.proofExpiration = options.proofExpiration;
    this.logger = options.logger || {
      // tslint:disable-next-line
      error: console.log,
      // tslint:disable-next-line
      info: console.log,
      // tslint:disable-next-line
      trace: console.log
    };

    this.heartbeatCtrl = new HeartbeatController(this);

    this.gossip = new GossipController(this, options.gossipHeartbeat);

    this.gossipRequestProcessorService = new GossipRequestProcessorService(this);
    this.requestProcessorService = new RequestProcessorService(this);

    this.db = new MokkaStorage(options.storage);

    this.logApi = new LogApi(this);
    this.nodeApi = new NodeApi(this);
  }

  public getDb(): MokkaStorage {
    return this.db;
  }

  public quorum(responses: number) {
    if (!this.nodes.size || !responses) return false;

    return responses >= this.majority();
  }

  public committedIndex() {

    const results = Array.from(this.nodes.values())
      .map((node) => node.getLastLogState().index)
      .filter((index) => index !== -1);

    if (results.length + 1 < this.majority())
      return -1;

    return results.sort()[0];
  }

  public majority() {
    return Math.ceil(this.nodes.size / 2) + 1;
  }

  public setVote(vote: VoteModel): void {
    this.vote = vote;
  }

  public async connect(): Promise<void> {
    const info = await this.getDb().getState().getInfo();

    if (info) {
      this.setState(NodeStates.FOLLOWER, info.term, null);
      this.setLastLogState(info);
    }

    this.gossip.start();
    this.logApi.runLoop();
    this.heartbeatCtrl.setNextBeat(Math.round(Math.random() * this.election.max));
    this.heartbeatCtrl.watchBeat();
  }

  public async disconnect(): Promise<void> {
    this.gossip.stop();
    this.logApi.stop();
    await this.heartbeatCtrl.stopBeat();
    await this.getDb().end();
  }

  public isProofTokenExpired(): boolean {
    return this.proofExpiration && this.getProofMintedTime() + this.proofExpiration < Date.now();
  }

  public async emitPacket(packet: Buffer) {
    const parsedPacket = JSON.parse(packet.toString());

    if ([
      messageTypes.GOSSIP_SECOND_RESPONSE,
      messageTypes.GOSSIP_FIRST_RESPONSE,
      messageTypes.GOSSIP_REQUEST
    ].includes(parsedPacket.type))
      return await this.gossipRequestProcessorService.process(parsedPacket);

    await this.requestProcessorService.process(parsedPacket);
  }

}

export {Mokka};
