import {PeerModel} from '../models/PeerModel';

class GossipScuttleService {

  private readonly peers: Map<string, PeerModel>;

  constructor(peers: Map<string, PeerModel>) {
    this.peers = peers;
  }

  public digest(): { [key: string]: number } {
    const digest: { [key: string]: number } = {};
    for (const pubKey of this.peers.keys()) {
      const p: PeerModel = this.peers.get(pubKey);
      digest[pubKey] = p.maxVersion;
    }

    return digest;
  }

  public scuttle(digest: { [key: string]: number }):
    {
      deltas: Array<[string, string, any, number]>,
      newPeers: string[],
      requests: { [key: string]: number }
    } {
    const deltasWithPeer: Array<{ peer: string, deltas: Array<[string, any, number]> }> = [];
    const requests: { [key: string]: number } = {};
    const newPeers: string[] = [];
    for (const pubKey of Object.keys(digest)) {
      const localPeer: PeerModel = this.peers.get(pubKey);
      const localVersion = localPeer.maxVersion;

      if (!this.peers.has(pubKey)) {
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

    const deltas: Array<[string, string, any, number]> = [];

    for (const item of deltasWithPeer) {
      const pubKey = item.peer;
      const peerDeltas = item.deltas;

      peerDeltas.sort((a, b) => a[2] - b[2]);

      for (const delta of peerDeltas) {
        deltas.push([pubKey, delta[0], delta[1], delta[2]]);
      }
    }

    return {
      deltas,
      newPeers,
      requests
    };
  }

  public updateKnownState(deltas: Array<[string, any, number]>): void {
    for (const delta of deltas) {
      const pubKey = delta.shift();
      const peerState = this.peers.get(pubKey);
      peerState.updateWithDelta(delta[0], delta[1], delta[2]);
    }
  }

  public fetchDeltas(requests: { [key: string]: number }): Array<[string, string, any, number]> {
    const deltas: Array<[string, string, any, number]> = [];
    for (const pubKey of Object.keys(requests)) {
      const peerDeltas = this.peers.get(pubKey).deltasAfterVersion(requests[pubKey]);
      peerDeltas.sort((a, b) => a[2] - b[2]);
      for (const delta of peerDeltas) {
        deltas.push([pubKey, delta[0], delta[1], delta[2]]);
      }
    }
    return deltas;
  }

}

export {GossipScuttleService};
