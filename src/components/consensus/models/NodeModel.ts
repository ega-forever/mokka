import {EventEmitter} from 'events';
import eventTypes from '../../shared/constants/EventTypes';
import {StateModel} from '../../storage/models/StateModel';
import NodeStates from '../constants/NodeStates';

class NodeModel extends EventEmitter {

  public readonly privateKey: string;
  public readonly publicKey: string;
  public readonly nodes: Map<string, NodeModel> = new Map<string, NodeModel>();
  private _state: number;
  private _term: number = 0;
  private _proof: string;
  private _leaderPublicKey: string = '';
  private readonly nodeAddress: string;
  // private lastLogIndex: number = 0;
  private lastLog: StateModel = {
    createdAt: Date.now(),
    hash: '',
    index: 0,
    term: 0
  };

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

  public write(address: string, packet: Buffer): void {
    throw new Error('should be implemented!');
  }

  public setState(state: number, term: number = this._term, leaderPublicKey: string, proof: string = null) {
    this._state = state;
    this._term = term;
    this._leaderPublicKey = leaderPublicKey;
    this._proof = proof;
    this.emit(eventTypes.STATE);
  }

  public setLastLogState(log: StateModel) {
    this.lastLog = log;
  }

  public getLastLogState() {
    return this.lastLog;
  }

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

}

export {NodeModel};
