import crypto from 'crypto';
import {EventEmitter} from 'events';
import eventTypes from '../../shared/constants/EventTypes';
import {StateModel} from '../../storage/models/StateModel';
import NodeStates from '../constants/NodeStates';
import {convertKeyPairToRawSecp256k1, convertPublicKeyToRawSecp256k1} from '../utils/keyPair';

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
  public readonly rawPublicKey: string;
  public readonly rawPrivateKey: string;
  private _state: number;
  private _term: number = 0;
  private _proof: string;
  private _leaderPublicKey: string = '';
  private readonly nodeAddress: string;
  private lastLog: StateModel = new StateModel();

  constructor(
    privateKey: string,
    multiaddr: string,
    state: number = NodeStates.FOLLOWER
  ) {
    super();

    this.privateKey = privateKey;

    if (this.privateKey) {
      const keyPair = crypto.createECDH('secp256k1');
      keyPair.setPrivateKey(Buffer.from(privateKey, 'hex'));
      const rawKeyPair = convertKeyPairToRawSecp256k1(keyPair);
      this.rawPrivateKey = rawKeyPair.privateKey;
      this.rawPublicKey = rawKeyPair.publicKey;
    }

    this.publicKey = multiaddr.match(/\w+$/).toString();
    if (!this.privateKey) {
      this.rawPublicKey = convertPublicKeyToRawSecp256k1(this.publicKey);
    }

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

  public setLastLogState(log: StateModel): void {
    this.lastLog = log;
  }

  public getLastLogState(): StateModel {
    return this.lastLog;
  }

}

export {NodeModel};
