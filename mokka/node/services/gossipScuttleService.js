class GossipScuttleService {

  constructor (peers) {
    this.peers = peers;
  }


  digest () {
    let digest = {};
    for (let pubKey of Object.keys(this.peers)) {
      let p = this.peers[pubKey];
      digest[pubKey] = p.maxVersionSeen;
    }
    return digest;
  }


  async scuttle (digest) {
    let deltasWithPeer = [];
    let requests = {};
    let newPeers = [];
    for (let pubKey of Object.keys(digest)) {
      //let localVersion = this.maxVersionSeenForPeer(pubKey);
      let localVersion = await this.peers[pubKey]._getMaxVersion();

      console.log(`local version ${localVersion} of peer ${pubKey}`)

      let localPeer = this.peers[pubKey];

      if (!this.peers[pubKey]) {
        requests[pubKey] = 0;
        newPeers.push(pubKey);
      } else if (localVersion > digest[pubKey]) {
        let deltas = await localPeer.deltasAfterVersion(digest[pubKey]);
        deltasWithPeer.push({peer: pubKey, deltas: deltas});
      } else if (localVersion < digest[pubKey])
        requests[pubKey] = localVersion;

    }

    // Sort by peers with most deltas
    deltasWithPeer.sort((a, b) => b.deltas.length - a.deltas.length);

    let deltas = [];
    for (let pubKey of Object.keys(deltasWithPeer)) {
      let peer = deltasWithPeer[pubKey];
      let peerDeltas = peer.deltas;

      peerDeltas.sort((a, b) => a[2] - b[2]);

      for (pubKey of Object.keys(peerDeltas)) {
        let delta = peerDeltas[pubKey];
        delta.unshift(peer.peer);
        deltas.push(delta);
      }
    }

    return {
      deltas: deltas,
      requests: requests,
      newPeers: newPeers
    };
  }

  maxVersionSeenForPeer (peer) {
    return this.peers[peer] ?
      this.peers[peer].maxVersionSeen : 0;
  }

  async updateKnownState (deltas) {
    for (let key of Object.keys(deltas)) {
      let delta = deltas[key];
      let pubKey = delta.shift();
      let peerState = this.peers[pubKey];
      await peerState.updateWithDelta(delta[0], delta[1], delta[2]);
    }
  }

  async fetchDeltas (requests) {
    let deltas = [];
    for (let pubKey of Object.keys(requests)) {
      let peerDeltas = await this.peers[pubKey].deltasAfterVersion(requests[pubKey]);
      peerDeltas.sort((a, b) => a[2] - b[2]);
      for (let delta of Object.keys(peerDeltas)) {
        peerDeltas[delta].unshift(pubKey);
        deltas.push(peerDeltas[delta]);
      }
    }
    return deltas;
  }


}

module.exports = GossipScuttleService;
