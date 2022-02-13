import { EventEmitter } from 'events';
import eventTypes from '../constants/EventTypes';
import NodeStates from '../constants/NodeStates';

class NodeModel extends EventEmitter {

  get state(): number {
    return this._state;
  }

  get term(): number {
    return this._term;
  }

  get leaderPublicKey(): string {
    return this._leaderPublicKey;
  }

  get address(): string {
    return this.nodeAddress;
  }

  get proof(): string {
    return this._proof;
  }

  public heartbeat: number;
  public proofExpiration: number;
  public electionTimeout: number;
  public publicKeysRoot: string;
  public publicKeysCombinationsInQuorum: string[][];
  public readonly privateKey: string;
  public readonly publicKey: string;
  public readonly nodes: Map<string, NodeModel> = new Map<string, NodeModel>();
  public readonly lastLeadersPublicKeyInTermMap: Map<number, string> = new Map<number, string>();

  private _state: number;
  private _term: number = 0;
  private lastTermUpdateTime: number = 0;
  private _proof: string;
  private _leaderPublicKey: string = '';
  private _proofMintedTime: number = 0;
  private readonly nodeAddress: string;
  private readonly crashModel: 'CFT' | 'BFT';

  constructor(
    privateKey: string,
    multiaddr: string,
    crashModel: 'CFT' | 'BFT' = 'CFT',
    state: number = NodeStates.FOLLOWER
  ) {
    super();
    this.privateKey = privateKey;
    this.publicKey = multiaddr.match(/\w+$/).toString();
    this._state = state;
    this.nodeAddress = multiaddr.split(/\w+$/)[0].replace(/\/$/, '');
    this.crashModel = crashModel;
  }

  public majority() {
    const clusterSize = this.nodes.size + 1; // peer nodes + self
    return clusterSize - Math.ceil((clusterSize - 1) / (this.crashModel === 'CFT' ? 2 : 3));
  }

  public write(address: string, packet: Buffer): void {
    throw new Error('should be implemented!');
  }

  public setState(
    state: number,
    term: number = this._term,
    leaderPublicKey: string,
    proof: string = null,
    proofMintedTime: number = 0) {
    this._state = state;

    if (this._term !== term) {
      this.lastTermUpdateTime = Date.now();
    }

    this._term = term;
    this._leaderPublicKey = leaderPublicKey;
    this._proof = proof;
    this._proofMintedTime = proofMintedTime;
    this.emit(eventTypes.STATE);

    if (this.leaderPublicKey) {
      if (this.lastLeadersPublicKeyInTermMap.size >= this.majority() - 1) {
        const prevTermsToRemove = [...this.lastLeadersPublicKeyInTermMap.keys()].sort()
          .slice(this.lastLeadersPublicKeyInTermMap.size - this.majority());

        for (const prevTerm of prevTermsToRemove) {
          this.lastLeadersPublicKeyInTermMap.delete(prevTerm);
        }
      }

      this.lastLeadersPublicKeyInTermMap.set(term, leaderPublicKey);
    }
  }

  public getProofMintedTime(): number {
    return this._proofMintedTime;
  }

  public checkPublicKeyCanBeLeaderNextRound(publicKey: string) {
    const values = [...this.lastLeadersPublicKeyInTermMap.values()];
    return !values.includes(publicKey);
  }

  public checkTermNumber(term: number) {
    if (!this.lastTermUpdateTime) {
      return true;
    }

    const maxPossibleTerm = this._term + Math.ceil((Date.now() - this.lastTermUpdateTime) / this.heartbeat * 1.5);
    return maxPossibleTerm >= term;
  }

}

export { NodeModel };
