import {NodeApi} from './api/NodeApi';
import {HeartbeatController} from './controllers/HeartbeatController';
import {ILoggerInterface} from './interfaces/ILoggerInterface';
import {ISettingsInterface} from './interfaces/ISettingsInterface';
import {NodeModel} from './models/NodeModel';
import {VoteModel} from './models/VoteModel';
import {RequestProcessorService} from './services/RequestProcessorService';

class Mokka extends NodeModel {

  public election: { min: number, max: number };
  public heartbeat: number;
  public proofExpiration: number;
  public readonly logger: ILoggerInterface;
  public vote: VoteModel;
  public readonly heartbeatCtrl: HeartbeatController;
  public readonly nodeApi: NodeApi;
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
    this.requestProcessorService = new RequestProcessorService(this);
    this.nodeApi = new NodeApi(this);
  }

  public quorum(responses: number) {
    if (!this.nodes.size || !responses) return false;

    return responses >= this.majority();
  }

  public setVote(vote: VoteModel): void {
    this.vote = vote;
  }

  public async connect(): Promise<void> {
    this.calculateMultiPublicKeys();

    this.heartbeatCtrl.setNextBeat(Math.round(Math.random() * this.election.max));
    this.heartbeatCtrl.watchBeat();
  }

  public async disconnect(): Promise<void> {
    await this.heartbeatCtrl.stopBeat();
  }

  public isProofTokenExpired(): boolean {
    return this.proofExpiration && this.getProofMintedTime() + this.proofExpiration < Date.now();
  }

  public async emitPacket(packet: Buffer) {
    const parsedPacket = JSON.parse(packet.toString());
    await this.requestProcessorService.process(parsedPacket);
  }

}

export {Mokka};
