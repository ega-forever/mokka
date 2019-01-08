const EventEmitter = require('events'),
  AccrualFailureDetector = require('../../utils/accrualFailureDetector');

class PeerState extends EventEmitter {

  constructor (pubKey, mokka) {
    super();
    this.mokka = mokka;
    this.pubKey = pubKey;
    this.maxVersionSeen = 0;
    this.attrs = {}; //local storage
    this.detector = new AccrualFailureDetector();
    this.alive = true;
    this.heartBeatVersion = 0;
    this.PHI = 8;
  }


  async updateWithDelta (k, v, n) {
    // It's possibly to get the same updates more than once if we're gossiping with multiple peers at once
    // ignore them
    if (n > this.maxVersionSeen) {
      this.maxVersionSeen = n;
      //this.setLocalKey(k, v, n);
      await this.addToDb(v); //todo implement

      if (k === '__heartbeat__') {
        let d = new Date();
        this.detector.add(d.getTime());
      }
    }
  }


  async addToDb (command) { //todo refactor
    this.maxVersionSeen += 1;
    await this.mokka.log.putPending(command, this.maxVersionSeen);
//    this.setLocalKey(k, v, this.maxVersionSeen);
  }

  async deleteLocal (hash) { //todo refactor
    await this.mokka.log.pullPending(hash);
  }

  setLocalKey (k, v, n) {
    this.attrs[k] = [v, n];
    this.emit('update', k, v);
  }


  async beatHeart () {
    this.heartBeatVersion += 1;
    await this.setLocalKey('__heartbeat__', this.heartBeatVersion, this.maxVersionSeen);
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
