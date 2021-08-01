import {EventEmitter} from 'events';
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

  public readonly privateKey: string;
  public readonly publicKey: string;
  public readonly nodes: Map<string, NodeModel> = new Map<string, NodeModel>();

  private _state: number;
  private _term: number = 0;
  private _proof: string;
  private _leaderPublicKey: string = '';
  private _proofMintedTime: number = 0;
  private readonly nodeAddress: string;

  constructor(
    privateKey: string,
    multiaddr: string,
    state: number = NodeStates.FOLLOWER
  ) {
    super();
    this.privateKey = privateKey;
    this.publicKey = multiaddr.match(/\w+$/).toString();
    this._state = state;
    this.nodeAddress = multiaddr.split(/\w+$/)[0].replace(/\/$/, '');
  }

  public majority() {
    return Math.ceil(this.nodes.size / 2) + 1;
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
    this._term = term;
    this._leaderPublicKey = leaderPublicKey;
    this._proof = proof;
    this._proofMintedTime = proofMintedTime;
    this.emit(eventTypes.STATE);
  }

  public getProofMintedTime(): number {
    return this._proofMintedTime;
  }

}

export {NodeModel};
