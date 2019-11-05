import crypto from 'crypto';
import {EventEmitter} from 'events';
import eventTypes from '../../shared/constants/EventTypes';

class PeerModel extends EventEmitter {

  private readonly pubKey: string;
  private readonly rawPubKey: string;
  private readonly attrs: Map<string, { value: any, number: number }>; // local storage
  private heartBeatVersion: number = 0;
  private maxVersionSeen: number = 0;

  constructor(pubKey: string, rawPubKey: string) {
    super();
    this.pubKey = pubKey;
    this.rawPubKey = rawPubKey;
    this.attrs = new Map<string, { value: any, number: number }>();
  }

  get publicKey(): string {
    return this.pubKey;
  }

  get maxVersion(): number {
    return this.maxVersionSeen;
  }

  public updateWithDelta(k: string, v: { key: string, value: any, signature: string }, n: number): void {
    if (n <= this.maxVersionSeen) {
      return;
    }
    this.setLocalKey(k, v, n);
    this.maxVersionSeen = n;
  }

  public setLocalKey(k: string, v: { key: string, value: any, signature: string }, n: number): void {

    if (!v.signature)
      return;

    const verify = crypto.createVerify('sha256');
    verify.update(Buffer.from(k));
    const isSigned = verify.verify(this.rawPubKey, Buffer.from(v.signature, 'hex'));

    if (!isSigned)
      return;

    if (n > this.maxVersionSeen)
      this.maxVersionSeen = n;

    this.attrs.set(k, {value: v, number: n});
    this.emit(eventTypes.GOSSIP_PEER_UPDATE, k, v);
  }

  public beatHeart(): void {
    this.heartBeatVersion += 1;
  }

  public deltasAfterVersion(lowestVersion: number, highestVersion: number): Array<[string, any, number]> {

    const data: Array<[string, any, number]> = [];

    for (const key of this.attrs.keys()) {
      const value = this.attrs.get(key);
      if (value.number > lowestVersion && value.number < highestVersion) {
        data.push([key, value.value, value.number]);
      }
    }

    return data.sort((item, item2) => item[2] > item2[2] ? 1 : -1);
  }

  public getPendingLogs(): Array<{ hash: string, log: any }> {

    const data: Array<{ hash: string, log: any }> = [];

    for (const key of this.attrs.keys()) {
      data.push({hash: key, log: this.attrs.get(key).value});
    }

    return data;
  }

  public getPending(key: string): any {
    return this.attrs.get(key);
  }

  public pullPending(key: string): void {
    this.attrs.delete(key);
  }
}

export {PeerModel};
