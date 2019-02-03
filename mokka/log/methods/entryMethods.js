const _ = require('lodash'),
  getBnNumber = require('../../utils/getBnNumber');



class EntryMethods {

  constructor (log) {
    this.log = log;
  }


  async getFirstByTerm (term) {
    try {
      let item = await this.log.db.get(`${this.log.prefixes.term}:${getBnNumber(term)}`);
      return await this.log.db.get(`${this.log.prefixes.logs}:${getBnNumber(item.index)}`);
    } catch (err) {
      return {
        index: 0,
        hash: ''.padStart(32, '0'),
        term: this.log.node.term
      };
    }
  }

  async getLastByTerm (term) {
    try {
      let headEntry = await this.getFirstByTerm(term);

      if (headEntry.index === 0)
        return headEntry;

      if (!headEntry)
        return {
          index: 0,
          hash: ''.padStart(32, '0'),
          term: this.log.node.term
        };

      return await this.log.db.get(`${this.log.prefixes.logs}:${getBnNumber(headEntry.index - 1)}`);

    } catch (err) {
      return {
        index: 0,
        hash: ''.padStart(32, '0'),
        term: this.log.node.term
      };
    }
  }

  async _getEntriesAfter (index, limit) {
    const entries = [];

    let query = {
      gt: `${this.log.prefixes.logs}:${getBnNumber(index)}`,
      lt: `${this.log.prefixes.logs + 1}:${getBnNumber(0)}`
    };

    if (limit)
      query.limit = limit;

    return await new Promise((resolve, reject) => {
      this.log.db.createReadStream(query)
        .on('data', data => {
          entries.push(data.value);
        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          resolve(entries);
        });
    });

  }

  async removeAfter (index) { //todo implement keep last term
    const entries = await this._getEntriesAfter(index);

    for (let entry of entries)
      await this.log.db.del(`${this.log.prefixes.logs}:${getBnNumber(entry.index)}`);


    let {term: lastTerm, index: lastIndex} = await this.getLastInfo();
    this.log.node.term = lastIndex === 0 ? 0 : lastTerm;

    this.log.emit(this.log.eventTypes.LOGS_UPDATED);
  }

  async get (index) {
    try {
      return await this.log.db.get(`${this.log.prefixes.logs}:${getBnNumber(index)}`);
    } catch (err) {
      return null;
    }

  }

  async getLastInfo () {
    try {
      return await this.log.db.get(`${this.log.prefixes.states}`);
    } catch (e) {
      return {
        index: 0,
        hash: ''.padStart(32, '0'),
        term: 0,
        committed: true,
        createdAt: Date.now()
      };
    }
  }

  async getLast () {

    let info = await this.getLastInfo();

    if(!info.index)
      return info;

    return await this.get(info.index);

  }

  async getInfoBefore (entry) {
    const {index, term, hash, createdAt} = await this._getBefore(entry);

    return {
      index,
      term,
      hash,
      createdAt
    };
  }

  _getBefore (entry) {
    const defaultInfo = {
      index: 0,
      term: this.log.node.term,
      hash: ''.padStart(32, '0')
    };
    // We know it is the first entry, so save the query time
    if (entry.index === 1)
      return Promise.resolve(defaultInfo);


    return new Promise((resolve, reject) => {
      let hasResolved = false;

      this.log.db.createReadStream({
        reverse: true,
        limit: 1,
        lt: `${this.log.prefixes.logs}:${getBnNumber(entry.index)}`,
        gt: `${this.log.prefixes.logs}:${getBnNumber(0)}`
      })
        .on('data', (data) => {
          hasResolved = true;
          resolve(data.value);
        })
        .on('error', (err) => {
          hasResolved = true;
          reject(err);
        })
        .on('end', () => {
          if (!hasResolved)
            resolve(defaultInfo);

        });
    });
  }

  getUncommittedUpToIndex (index) {
    return new Promise((resolve, reject) => {
      const entries = [];

      this.log.db.createReadStream({
        gt: `${this.log.prefixes.logs}:${getBnNumber(this.log.committedIndex)}`,
        lte: `${this.log.prefixes.logs}:${getBnNumber(index)}`
      })
        .on('data', data => {
          if (!data.value.committed)
            entries.push(data.value);

        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          resolve(entries);
        });
    });
  }

  async _getByHash (hash) {
    try {
      let refIndex = await this.log.db.get(`${this.log.prefixes.refs}:${hash}`);
      return await this.get(refIndex);
    } catch (err) {
      return null;
    }

  }

  async _put (entry) {//todo implement the strategy for update system state

    let firstEntryByTerm = await this.getFirstByTerm(entry.term);

    if (!firstEntryByTerm.index) {
      let proof = await this.log.proof.get(entry.term);

      proof.hash = entry.hash;
      proof.index = entry.index;

      await this.log.db.put(`${this.log.prefixes.term}:${getBnNumber(entry.term)}`, proof);
    }

    let result = await this.log.db.put(`${this.log.prefixes.logs}:${getBnNumber(entry.index)}`, entry);
    await this.log.db.put(`${this.log.prefixes.refs}:${entry.hash}`, entry.index);

    let state = _.pick(entry, ['index', 'term', 'hash', 'createdAt']);
    await this.log.db.put(`${this.log.prefixes.states}`, state);

    this.log.emit(this.log.eventTypes.LOGS_UPDATED);
    return result;
  }

}

module.exports = EntryMethods;
