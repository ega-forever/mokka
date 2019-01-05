const EventEmitter = require('events'),
  AccrualFailureDetector = require('../../utils/accrualFailureDetector');

class PeerState extends EventEmitter {

  constructor (pubKey) {
    super();
    this.pubKey = pubKey;
    this.maxVersionSeen = 0;
    this.attrs = {};
    this.detector = new AccrualFailureDetector();
    this.alive = true;
    this.heartBeatVersion = 0;
    this.PHI = 8;
  }


  updateWithDelta (k, v, n) {
    // It's possibly to get the same updates more than once if we're gossiping with multiple peers at once
    // ignore them
    if (n > this.maxVersionSeen) {
      this.maxVersionSeen = n;
      this.setKey(k, v, n);
      if (k === '__heartbeat__') {
        let d = new Date();
        this.detector.add(d.getTime());
      }
    }
  }


  updateLocal (k, v) {
    this.maxVersionSeen += 1;
    this.setKey(k, v, this.maxVersionSeen);
  }

  getValue (k) {
    if (!this.attrs[k])
      return;

    return this.attrs[k][0];
  }

  getKeys () {
    return Object.keys(this.attrs);
  }

  setKey (k, v, n) {
    this.attrs[k] = [v, n];
    this.emit('update', k, v);
  }


  beatHeart () {
    this.heartBeatVersion += 1;
    this.updateLocal('__heartbeat__', this.heartBeatVersion);
  }

  deltasAfterVersion (lowestVersion) {
    const deltas = [];
    for (let k in this.attrs) {
      let value = this.attrs[k][0];
      let version = this.attrs[k][1];
      if (version > lowestVersion)
        deltas.push([k, value, version]);

    }
    return deltas;
  }

  isSuspect () {
    let d = new Date();
    let phi = this.detector.phi(d.getTime());
    if (phi > this.PHI) {
      this.markDead();
      return true;
    }

    this.markAlive();
    return false;
  }

  markAlive () {
    if (!this.alive) {
      this.alive = true;
      this.emit('peer_alive');
    }
  }


  markDead () {
    if (this.alive) {
      this.alive = false;
      this.emit('peer_failed');
    }
  }
}

module.exports = PeerState;
