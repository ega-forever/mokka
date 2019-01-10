const EventEmitter = require('events'),
  Promise = require('bluebird'),
  _ = require('lodash'),

  AccrualFailureDetector = require('../../utils/accrualFailureDetector');

class PeerState extends EventEmitter {

  constructor (pubKey, mokka) {
    super();
    this.mokka = mokka;
    this.pubKey = pubKey;
    this.attrs = {}; //local storage
    this.detector = new AccrualFailureDetector();
    this.alive = true;
    this.heartBeatVersion = 0;
    this.maxVersionSeen = 0;
    this.PHI = 8;
  }


  async updateWithDelta (k, v, n) {

    if (n > this.maxVersionSeen) {

      if (k === '__heartbeat__') {
        let d = new Date();
        this.detector.add(d.getTime());
        this.setLocalKey(k, v, n);
      } else {
        this.mokka.logger.info(`received pending ${k} with next version ${this.maxVersionSeen + 1}`);
        await this.addToDb(v); //todo implement
      }
    }
  }

  async _getMaxVersion(){
    let {index} = await this.mokka.lastInfo;
    let count = await this.mokka.log.getPendingCount();
    return index + count;
  }

  async addToDb (command) { //todo refactor
    await this.mokka.log.putPending(command, this.maxVersionSeen + 1);
    this.maxVersionSeen = await this._getMaxVersion();
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

    let items = await Promise.mapSeries(hashes, async hash => {
      let item = await this.mokka.log.getPending(hash);

      if (!item)
        return;

      return [hash, item.command, item.version];
    });


    return _.chain(items)
      .compact()
      .sortBy(item => item[2])
      .transform((result, item) => {

        if (result.length) {
          let prev = _.last(result);
          if (prev[2] + 1 !== item[2])
            return;
        }

        result.push(item);

      }, [])
      .value();

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
