const _ = require('lodash'),
  crypto = require('crypto'),
  getBnNumber = require('../../utils/getBnNumber');

class PendingMethods {

  constructor (log) {
    this.log = log;
  }


  async checkCommitted (command) {
    const hash = crypto.createHmac('sha256', JSON.stringify(command)).digest('hex');
    let record = await this.log.entry._getByHash(hash);
    return !!record;
  }

  async put (command, version, peer) {

    let record = {command, received: this.log.node.leader === this.log.node.publicKey, version};

    const hash = crypto.createHmac('sha256', JSON.stringify(command)).digest('hex');

    let existedLog = await this.log.entry._getByHash(hash);

    if (existedLog || command === null) {
      await this.log.db.put(`${this.log.prefixes.pendingStates}:${peer}`, version);
      return;
    }

    await this.log.db.put(`${this.log.prefixes.pending}:${hash}`, record);
    await this.log.db.put(`${this.log.prefixes.pendingRefs}:${peer}:${getBnNumber(version)}`, hash);
    await this.log.db.put(`${this.log.prefixes.pendingStates}:${peer}`, version);

    return {
      command: command,
      hash: hash,
      received: record.received
    };
  }

  async pull (hash) {//todo reimplement

    let pending = await this.get(hash);

    if (!pending)
      return;

    await this.log.db.del(`${this.log.prefixes.pending}:${hash}`);

    let refs = await this._getRefsByHash(hash);

    for (let ref of refs)
      await this.log.db.del(ref);
  }

  async _getRefsByHash (hash) {

    return await new Promise((resolve, reject) => {

      let refs = [];

      this.log.db.createReadStream({
        lt: `${this.log.prefixes.pendingRefs + 1}`,
        gte: `${this.log.prefixes.pendingRefs}`
      })
        .on('data', (data) => {
          if (data.value === hash)
            refs.push(data.key.toString());
        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          resolve(refs);
        });
    });


  }

  async get (hash, task = false) {

    if (task)
      hash = crypto.createHmac('sha256', JSON.stringify(task)).digest('hex');

    try {
      return await this.log.db.get(`${this.log.prefixes.pending}:${hash}`);
    } catch (e) {
      return null;
    }
  }

  async getFirst () {

    let pending = await new Promise((resolve, reject) => {

      let record;

      this.log.db.createReadStream({
        limit: 1,
        lt: `${this.log.prefixes.pending + 1}:${getBnNumber(0)}`,
        gte: `${this.log.prefixes.pending}:${getBnNumber(0)}`
      })
        .on('data', data => {
          record = data.value;
        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          resolve(record);
        });
    });

    if (!pending)
      return {
        hash: null,
        command: null
      };

    let hash = crypto.createHmac('sha256', JSON.stringify(pending.command)).digest('hex');

    return {
      hash: hash,
      command: pending.command
    };
  }

  async getCount (peer) {
    try {
      return await this.log.db.get(`${this.log.prefixes.pendingStates}:${peer}`);
    } catch (e) {
      return 0;
    }
  }

  async getHashesAfterVersion (version, peer, limit) {

    return await new Promise((resolve, reject) => {

      let items = [];

      let query = {
        lt: `${this.log.prefixes.pendingRefs + 1}:${peer}:${getBnNumber(0)}`,
        gt: `${this.log.prefixes.pendingRefs}:${peer}:${getBnNumber(version)}`
      };

      if (_.isNumber(limit))
        query.limit = limit;

      this.log.db.createReadStream(query)
        .on('data', data => {
          if (data.key.toString().includes(peer))
            items.push(data.value);
        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          resolve(items);
        });
    });
  }

}

module.exports = PendingMethods;
