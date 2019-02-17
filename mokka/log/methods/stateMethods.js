const StateModel = require('../models/stateModel'),
  semaphore = require('semaphore');


class StateMethods {

  constructor (log) {
    this.log = log;
    this.sem = semaphore(1);

    //todo memdb for keeping unconfirmed changes to triggers during snapshotting

    this.prefixes = {
      triggers: {
        temp: 1,
        permanent: 2,
        state: 3
      },
      snapshots: {
        state: 1,
        triggers: 2
      }

    };
  }


  getApplierFuncs (index) {

    return {
      get: this.get.bind(this),
      put: this.put.bind(this, index),
      del: this.del.bind(this, index)
    }

  }

  async get (key) {
    try {
      return await this.log.db.get(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:${key}`);
    } catch (err) {
      return null;
    }
  }

  async getLastApplied () {
    try {
      return await this.log.db.get(`${this.log.prefixes.triggers}.${this.prefixes.triggers.state}`);
    } catch (err) {
      return 0;
    }
  }

  async put (index, key, value, rewrite = false) {//todo lock until snapshot is done

    let lastApplied = await this.getLastApplied();

    if (!rewrite && lastApplied >= index)
      return console.log('already applied');

    //  if (this.sem.available())
    await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:${key}`, value);
    await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.state}`, index);


    //return await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.temp}:${key}`, value);//todo scheduler
  }

  async del (index, key) {

    let lastApplied = await this.getLastApplied();

    if (lastApplied >= index)
      return;

    await this.log.db.del(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:${key}`);
    await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.state}`, index);
  }

  async getAll (confirmed = false, skip = 0, limit = 100, applier) {

    let state = await new Promise((resolve, reject) => {

      const stateModel = new StateModel({});

      let count = 0;

      this.log.db.createReadStream({
        lt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent + 1}`,
        gt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}`
      })
        .on('data', (data) => {


          count++;

          if (count < skip || count - skip > limit)
            return;

          let key = data.key.toString().replace(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:`, '');
          stateModel.put(key, data.value);
        })
        .on('error', (err) => {
          reject(err);
        })
        .on('end', () => {
          resolve(stateModel);
        });
    });

    if (confirmed)
      return state.state;

    const info = await this.log.entry.getLastInfo();
    let entries = await this.log.entry.getUncommittedUpToIndex(info.index);

    for (let entry of entries)
      await applier(entry.command, state);

    return state.state;

  }

  async delAll () {


    let rsDel = this.log.db.createKeyStream({
      lt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent + 1}`,
      gt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}`
    });


    rsDel.on('data', async data => {
      rsDel.pause();
      await this.log.db.del(data);
      rsDel.resume();
    });

    await new Promise(res => rsDel.once('end', res));

  }


  async getCount () {

    let count = 0;
    let rs = this.log.db.createKeyStream({
      lt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent + 1}`,
      gt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}`
    });


    rs.on('data', () => {
      count++
    });

    await new Promise(res => rs.once('end', res));

    return count;
  }

  async getSnapshotState () {
    try {
      return await this.log.db.get(`${this.log.prefixes.snapshots}.${this.prefixes.snapshots.state}`);
    } catch (err) {
      return {
        index: 0,
        count: 0
      };
    }
  }

  async takeSnapshot (index) {
    await new Promise(res => {
      this.sem.take(async () => {

        if (await this._isSnapshotOutdated(index)) {
          await this._cleanupSnapshot();
          await this._createSnapshot();
        }

        this.sem.leave();
        res();
      });
    })
  }

  async _isSnapshotOutdated (index) {

    let lastApplied = await this.getLastApplied();
    return index > lastApplied
  }

  async _cleanupSnapshot () {


    await this.log.db.del(`${this.log.prefixes.snapshots}.${this.prefixes.snapshots.state}`);


    let rsDel = this.log.db.createKeyStream({
      lt: `${this.log.prefixes.snapshots}.${this.prefixes.snapshots.triggers + 1}`,
      gt: `${this.log.prefixes.snapshots}.${this.prefixes.snapshots.triggers}`
    });


    rsDel.on('data', async data => {
      rsDel.pause();
      await this.log.db.del(data);
      rsDel.resume();
    });

    await new Promise(res => rsDel.once('end', res));


  }

  async _createSnapshot () {

    let rsCreate = this.log.db.createReadStream({
      lt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent + 1}:`,
      gt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:`
    });

    let count = 0;
    rsCreate.on('data', async data => {
      rsCreate.pause();
      let key = data.key.toString().replace(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:`, '');
      await this.log.db.put(`${this.log.prefixes.snapshots}.${this.prefixes.snapshots.triggers}:${key}`, data.value);
      count++;
      rsCreate.resume();
    });

    let lastApplied = await this.getLastApplied();
    await this.log.db.put(`${this.log.prefixes.snapshots}.${this.prefixes.snapshots.state}`, {
      index: lastApplied,
      count: count,
      created: Date.now()
    });

    await new Promise(res => rsCreate.once('end', res));
  }

  async getSnapshot (index, skip, limit) {

    if (await this._isSnapshotOutdated(index))
      await this.takeSnapshot(index);

    return await this.getAll(true, skip, limit);
  }

}


module.exports = StateMethods;
