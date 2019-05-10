import {EventEmitter} from 'events';
import sortBy from 'lodash/sortBy';
import toPairs from 'lodash/toPairs';
import nacl from 'tweetnacl';
import eventTypes from '../../shared/constants/EventTypes';
import {IIndexObject} from '../../shared/types/IIndexObjectType';
import {AccrualFailureDetector} from '../utils/accrualFailureDetector';

class PeerModel extends EventEmitter {

  private pubKey: string;
  private attrs: IIndexObject<string> = {}; // local storage
  private detector = new AccrualFailureDetector();
  private alive: boolean = true;
  private heartBeatVersion: number = 0;
  private maxVersionSeen: number = 0;
  private PHI: number = 8;
  private HEARTBEAT_KEY = '__heartbeat__';

  constructor(pubKey: string) {
    super();
    this.pubKey = pubKey;
  }

  get publicKey(): string {
    return this.pubKey;
  }

  get maxVersion(): number {
    return this.maxVersionSeen;
  }

  public updateWithDelta(k: string, v: string, n: number): void {
    if (n > this.maxVersionSeen) {
      const d = new Date();
      this.detector.add(d.getTime());
      this.setLocalKey(k, v, n);
      this.maxVersionSeen = n;
    }
  }

  public setLocalKey(k: string, v: any, n: number): void {

    if (k !== this.HEARTBEAT_KEY) {

      if (!v.signature)
        return;

      const isSigned = nacl.sign.detached.verify(
        Buffer.from(k),
        Buffer.from(v.signature, 'hex'),
        Buffer.from(this.pubKey, 'hex')
      );

      if (!isSigned)
        return;
    }

    if (n > this.maxVersionSeen)
      this.maxVersionSeen = n;

    // @ts-ignore
    this.attrs[k] = [v, n];
    this.emit(eventTypes.GOSSIP_PEER_UPDATE, k, v);
  }

  public beatHeart(): void {
    this.heartBeatVersion += 1;
    this.setLocalKey(this.HEARTBEAT_KEY, this.heartBeatVersion.toString(), this.maxVersionSeen);
  }

  public deltasAfterVersion(lowestVersion: number): any[] {

    const pairs = toPairs(this.attrs).filter((pair: any[]) =>
      pair[0] !== this.HEARTBEAT_KEY && pair[1][1] > lowestVersion)
      .map((pair: any[]) =>
        [pair[0], ...pair[1]]
      );

    return sortBy(pairs, (item: any[]) => item[2]);
  }

  public isSuspect(): boolean {
    const d = new Date();
    const phi = this.detector.phi(d.getTime());
    if (phi > this.PHI) {
      this.markDead();
      return true;
    }

    this.markAlive();
    return false;
  }

  public isAlive(): boolean {
    return this.alive;
  }

  public markAlive(): void {
    if (!this.alive) {
      this.alive = true;
      this.emit(eventTypes.GOSSIP_PEER_ALIVE);
    }
  }

  public markDead(): void {
    if (this.alive) {
      this.alive = false;
      this.emit(eventTypes.GOSSIP_PEER_FAILED);
    }
  }

  public getPendingLogs(): Array<{ hash: string, log: any }> {
    const data = toPairs(this.attrs)
      .filter((pair: any[]) => pair[0] !== this.HEARTBEAT_KEY)
      .map((pair: any[]) => ({hash: pair[0], log: pair[1][0]}));

    // @ts-ignore
    return sortBy(data, (item: any[]) => item[2]);
  }

  public getPending(key: string): any {
    return this.attrs[key];
  }

  public pullPending(key: string): void {
    delete this.attrs[key];
  }
}

export {PeerModel};
