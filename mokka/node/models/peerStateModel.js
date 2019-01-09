const EventEmitter = require('events'),
  Promise = require('bluebird'),
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

      if (k === '__heartbeat__') {
        let d = new Date();
        this.detector.add(d.getTime());
        this.setLocalKey(k, v, n);
      } else {
        await this.addToDb(v); //todo implement
      }
    }
  }


  async addToDb (command) { //todo refactor
    let entry = await this.mokka.log.putPending(command, this.maxVersionSeen + 1);
    if (entry)
      this.maxVersionSeen += 1;
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

  async deltasAfterVersion (lowestVersion) {//todo refactor (replace attrs with log)

    let hashes = await this.mokka.log.getPendingHashesAfterVersion(lowestVersion);

    return await Promise.mapSeries(hashes, async hash => {
      let item = await this.mokka.log.getPending(hash);
      return [hash, item.command, item.version];
    });
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
