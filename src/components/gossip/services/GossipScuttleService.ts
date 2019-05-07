import {IIndexObject} from '../../shared/types/IIndexObjectType';
import {PeerModel} from '../models/PeerModel';

class GossipScuttleService {

  private peers: IIndexObject<PeerModel>;

  constructor(peers: IIndexObject<PeerModel>) {
    this.peers = peers;
  }

  public digest(): IIndexObject<number> {
    const digest: IIndexObject<number> = {};
    for (const pubKey of Object.keys(this.peers)) {
      const p: PeerModel = this.peers[pubKey];
      digest[pubKey] = p.maxVersion;
    }

    return digest;
  }

  public scuttle(digest: IIndexObject<number>) {
    const deltasWithPeer: Array<{ peer: string, deltas: any[] }> = [];
    const requests: IIndexObject<number> = {};
    const newPeers = [];
    for (const pubKey of Object.keys(digest)) {
      const localPeer: PeerModel = this.peers[pubKey];
      const localVersion = localPeer.maxVersion;

      if (!this.peers[pubKey]) {
        requests[pubKey] = 0;
        newPeers.push(pubKey);
      } else if (localVersion > digest[pubKey]) {
        const deltas = localPeer.deltasAfterVersion(digest[pubKey]);
        deltasWithPeer.push({peer: pubKey, deltas});
      } else if (localVersion < digest[pubKey])
        requests[pubKey] = localVersion;
    }

    // Sort by peers with most deltas
    deltasWithPeer.sort((a, b) => b.deltas.length - a.deltas.length);

    const deltas = [];

    for (const item of deltasWithPeer) {
      const pubKey = item.peer;
      const peerDeltas = item.deltas;

      peerDeltas.sort((a, b) => a[2] - b[2]);

      for (const delta of peerDeltas) {
        delta.unshift(pubKey);
        deltas.push(delta);
      }
    }

    return {
      deltas,
      newPeers,
      requests
    };
  }

  public updateKnownState(deltas: any[]) {
    for (const delta of deltas) {
      const pubKey = delta.shift();
      const peerState = this.peers[pubKey];
      peerState.updateWithDelta(delta[0], delta[1], delta[2]);
    }
  }

  public fetchDeltas(requests: IIndexObject<number>) {
    const deltas = [];
    for (const pubKey of Object.keys(requests)) {
      const peerDeltas = this.peers[pubKey].deltasAfterVersion(requests[pubKey]);
      peerDeltas.sort((a, b) => a[2] - b[2]);
      for (const delta of peerDeltas) {
        delta.unshift(pubKey);
        deltas.push(delta);
      }
    }
    return deltas;
  }

}

export {GossipScuttleService};
