import * as EventEmitter from 'events';
// @ts-ignore
import * as Multiaddr from 'multiaddr';
import NodeStates from '../constants/NodeStates';

class NodeModel extends EventEmitter {

  public privateKey: string;
  public publicKey: string;
  public nodes: NodeModel[] = [];
  private _state: number;
  private _term: number = 0;
  private _proof: string;
  private _leaderPublicKey: string = '';
  private nodeAddress: string;

  constructor(
    privateKey: string,
    multiaddr: string,
    state: number = NodeStates.FOLLOWER
  ) {
    super();

    this.privateKey = privateKey;
    this.publicKey = multiaddr.match(/\w+$/).toString();
    this._state = state;

    const address = multiaddr.split(/\w+$/)[0];
    const m = Multiaddr(address);
    const mOptions = m.toOptions();
    this.nodeAddress = `${mOptions.transport}://${mOptions.host}:${mOptions.port}`;
  }

  public write(address: string, packet: Buffer): void {
    throw new Error('should be implemented!');
  }

  public setState(state: number, term: number = this._term, leaderPublicKey: string, proof: string = null) {
    this._state = state;
    this._term = term;
    this._leaderPublicKey = leaderPublicKey;
    this._proof = proof;
    this.emit('state');
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
