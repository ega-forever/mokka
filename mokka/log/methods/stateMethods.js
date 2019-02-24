const StateModel = require('../models/stateModel'),
  fs = require('fs-extra'),
  lineReader = require('line-reader'),
  _ = require('lodash'),
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
      }
    };

  }


  getApplierFuncs (index, hash, term) {

    return {
      get: this.get.bind(this),
      put: this.put.bind(this, index, hash, term),
      del: this.del.bind(this, index, hash, term)
    };

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
      return {
        index: 0,
        hash: ''.padStart(32, '0'),
        term: 0
      };
    }
  }

  async put (index, hash, term, key, value, rewrite = false) {

    await new Promise(res => {

      this.sem.take(async () => {
        let lastApplied = await this.getLastApplied();

        if (!rewrite && lastApplied.index >= index)
          return;

        await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:${key}`, value);
        await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.state}`, {index, hash, term});
        res();
        this.sem.leave();
      });

    });
  }

  async del (index, hash, term, key, rewrite = false) {

    await new Promise(res => {

      this.sem.take(async () => {
        let lastApplied = await this.getLastApplied();

        if (!rewrite && lastApplied.index >= index)
          return;

        await this.log.db.del(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:${key}`);
        await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.state}`, {index, hash, term});
        res();
        this.sem.leave();
      });

    });

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

  async _getNextTrigger () {

    return await new Promise(res => {
      let trigger;

      this.log.db.createKeyStream({
        lt: this.log.prefixes.triggers + 1,
        gt: this.log.prefixes.triggers,
        limit: 1
      }).on('data', async data => {//todo refactor
        trigger = data;
      }).on('end', () => res(trigger));

    });
  }

  async dropAll () {

    let trigger = await this._getNextTrigger();

    while (trigger) {
      await this.log.db.del(trigger.key);
      trigger = await this._getNextTrigger();
    }

    await this.log.entry.removeAfter(0);
    await this.log.db.del(this.log.prefixes.states);
  }

  async takeSnapshot (path) {
    await new Promise(res => {
      this.sem.take(async () => {

        await fs.remove(path);
        let info = await this.getLastApplied();
        let dataWs = fs.createWriteStream(path, {flags: 'a'});
        dataWs.write(`${JSON.stringify(info)}\n`);

        await new Promise((resolve, reject) => {

          this.log.db.createReadStream({
            lt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent + 1}`,
            gt: `${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}`
          })
            .on('data', (data) => {
              let key = data.key.toString().replace(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:`, '');
              dataWs.write(`${JSON.stringify({key, value: data.value})}\n`);
            })
            .on('error', (err) => {
              reject(err);
            })
            .on('end', () => {
              dataWs.end();
              resolve();
            });
        });

        this.sem.leave();
        res();
      });
    });
  }

  async appendSnapshot (path) {

    await this.dropAll();

    let info = await new Promise((res, rej) => {

      let header;

      lineReader.eachLine(path, async (line, last, callback) => {

        if (!header) {
          header = JSON.parse(line);
          return callback();
        }

        let trigger = JSON.parse(line);
        await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.permanent}:${trigger.key}`, trigger.value);

        callback();
      }, err => err ? rej() : res(header));
    });

    if (!info)
      return;

    let defaultState = _.merge({committed: true, created: Date.now()}, info);

    await this.log.db.put(this.log.prefixes.states, defaultState);
    await this.log.db.put(`${this.log.prefixes.triggers}.${this.prefixes.triggers.state}`, info);
  }


}


module.exports = StateMethods;
