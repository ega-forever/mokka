import {EventEmitter} from 'events';
import * as _ from 'lodash';
import {IIndexObject} from '../types/IIndexObjectType';
import {AccrualFailureDetector} from '../utils/accrualFailureDetector';

class PeerModel extends EventEmitter {

  private pubKey: string;
  private attrs: IIndexObject<string> = {}; // local storage
  private detector = new AccrualFailureDetector();
  private alive: boolean = true;
  private heartBeatVersion: number = 0;
  private maxVersionSeen: number = 0;
  private PHI: number = 8;

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

  public setLocalKey(k: string, v: string, n: number): void {

    if (n > this.maxVersionSeen)
      this.maxVersionSeen = n;

    // @ts-ignore
    this.attrs[k] = [v, n];
    this.emit('update', k, v);
  }

  public beatHeart(): void {
    this.heartBeatVersion += 1;
    this.setLocalKey('__heartbeat__', this.heartBeatVersion.toString(), this.maxVersionSeen);
  }

  public deltasAfterVersion(lowestVersion: number): any[] {

    return _.chain(this.attrs).toPairs().filter((pair: any[]) =>
      pair[0] !== '__heartbeat__' && pair[1][1] > lowestVersion)
      .map((pair: any[]) =>
        [pair[0], ...pair[1]]
      )
      .sortBy((item: any[]) => item[2])
      .value();
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
      this.emit('peer_alive');
    }
  }

  public markDead(): void {
    if (this.alive) {
      this.alive = false;
      this.emit('peer_failed');
    }
  }

  public getPendingLogs(): Array<{ hash: string, log: any }> {
    // @ts-ignore
    return _.chain(this.attrs).toPairs()
      .filter((pair: any[]) => pair[0] !== '__heartbeat__')
      .map((pair: any[]) => ({hash: pair[0], log: pair[1][0]}))
      .sortBy((item: any[]) => item[2])
      .value();
  }

  public getPending(key: string): any {
    return this.attrs[key];
  }

  public pullPending(key: string): void {
    delete this.attrs[key];
  }
}

export {PeerModel};
