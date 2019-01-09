const encode = require('encoding-down'),
  _ = require('lodash'),
  semaphore = require('semaphore')(1),
  crypto = require('crypto'),
  MerkleTools = require('merkle-tools'),
  levelup = require('levelup'),
  EventEmitter = require('events'),
  restorePubKey = require('../utils/restorePubKey');


class Log extends EventEmitter {

  constructor (node, options = {}) {
    super();

    let _options = _.cloneDeep(options);

    if (!_options.adapter)
      _options.adapter = require('memdown');

    this.prefixes = {
      logs: 1,
      term: 2,
      pending: 3,
      refs: 4,
      pendingRefs: 5
    };

    this.eventTypes = {
      LOGS_UPDATED: 'logs_updated'
    };

    this.node = node;


    this.db = levelup(encode(_options.adapter(`${options.path}_db`), {valueEncoding: 'json', keyEncoding: 'binary'}));
  }


  async saveCommand (command, term, signature, index, checkHash) {

    return await new Promise((res, rej) => {
      semaphore.take(async () => {

        if (!command || _.isEmpty(command)) {
          semaphore.leave();
          return rej({code: 0, message: 'task can\'t be empty'});
        }


        const owner = restorePubKey(command, signature);

        const {index: lastIndex, hash: lastHash} = await this.getLastInfo();


        if (_.isNumber(index) && index !== 0 && index <= lastIndex) {
          semaphore.leave();
          return rej({code: 1, message: `can't rewrite chain (received ${index} while current is ${lastIndex})!`});
        }

        if (_.isNumber(index) && index !== 0 && index !== lastIndex + 1) {
          semaphore.leave();
          return rej({
            code: 3,
            message: `can't apply logs not in direct order (received ${index} while current is ${lastIndex})!`
          });
        }

        if (!_.isNumber(index))
          index = lastIndex + 1;

        const merkleTools = new MerkleTools();
        merkleTools.addLeaf(lastHash);

        merkleTools.addLeaf(JSON.stringify(command), true);
        merkleTools.makeTree();

        let generatedHash = merkleTools.getMerkleRoot().toString('hex');

        if (checkHash && generatedHash !== checkHash) {
          semaphore.leave();
          return rej({code: 2, message: 'can\'t save wrong hash!'});
        }


        const entry = {
          term: term,
          index: index,
          hash: generatedHash,
          createdAt: Date.now(),
          committed: false,
          owner: owner,
          responses: [
            {
              publicKey: owner,
              ack: true
            }
          ],
          shares: [],
          minShares: 0,
          signature,
          command
        };

        if (entry.owner !== this.node.publicKey)
          entry.responses.push({
            publicKey: this.node.publicKey, // start with vote from leader
            ack: true
          });

        await this.put(entry);
        res(entry);
        semaphore.leave();

      });
    });
  }

  static _getBnNumber (num = 0) {
    num = num.toString(2);
    return new Array(64 - num.length).fill('0').join('') + num;
  }

  /**
   * put - Save entry to database using the index as the key
   *
   * @async
   * @param {Entry} entry entry to save
   * @return {Promise<void>} Resolves once entry is saved
   * @public
   */
  async put (entry) {

    let firstEntryByTerm = await this.getFirstEntryByTerm(entry.term);

    if (!firstEntryByTerm.index) {
      let proof = await this.getProof(entry.term);

      proof.hash = entry.hash;
      proof.index = entry.index;

      await this.db.put(`${this.prefixes.term}:${Log._getBnNumber(entry.term)}`, proof);
    }

    let result = await this.db.put(`${this.prefixes.logs}:${Log._getBnNumber(entry.index)}`, entry);
    await this.db.put(`${this.prefixes.refs}:${entry.hash}`, entry.index);
    this.emit(this.eventTypes.LOGS_UPDATED);
    return result;
  }

  async checkPendingCommitted (command) {
    const hash = crypto.createHmac('sha256', JSON.stringify(command)).digest('hex');

    let record = await this.getByHash(hash);

    return !!record;
  }

  async putPending (command, version) {

    let record = {command, received: this.node.leader === this.node.publicKey, version};

    const hash = crypto.createHmac('sha256', JSON.stringify(command)).digest('hex');

    let existedPendingLog = await this.getPending(hash);

    if(existedPendingLog)
      return;

    let existedLog = await this.getByHash(hash);

    if(existedLog)
      return;

    await this.db.put(`${this.prefixes.pending}:${hash}`, record);
    await this.db.put(`${this.prefixes.pendingRefs}:${Log._getBnNumber(version)}:${hash}`, hash);

    return {
      command: command,
      hash: hash,
      received: record.received
    };
  }

  async ackPending (hash) { //todo remove?

    let entry = await this.db.get(`${this.prefixes.pending}:${hash}`);

    if (!entry)
      return;

    entry.received = true;
    await this.db.put(`${this.prefixes.pending}:${hash}`, entry);

    return entry;
  }

  async pullPending (hash) {

    let pending = await this.getPending(hash);

    if (!pending)
      return;

    await this.db.del(`${this.prefixes.pending}:${hash}`);
    await this.db.del(`${this.prefixes.pendingRefs}:${Log._getBnNumber(pending.version)}:${hash}`);


  }

  async getPending (hash, task = false) {

    if (task)
      hash = crypto.createHmac('sha256', JSON.stringify(task)).digest('hex');

    try {
      return await this.db.get(`${this.prefixes.pending}:${hash}`);
    } catch (e) {
      return null;
    }
  }

  async getFirstPending () {

    return await new Promise((resolve, reject) => {

      let item = {
        hash: null,
        command: null
      };

      this.db.createReadStream({
        limit: 1,
        lt: `${this.prefixes.pending + 1}:${Log._getBnNumber(0)}`,
        gte: `${this.prefixes.pending}:${Log._getBnNumber(0)}`
      })
        .on('data', data => {
          item = data.value;
          item.hash = data.key.toString().replace(`${this.prefixes.pending}:`, '');
        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          resolve(item);
        });
    });
  }

  async getPendingHashesAfterVersion (version) {

    return await new Promise((resolve, reject) => {

      let items = [];

      this.db.createReadStream({
        lt: `${this.prefixes.pendingRefs + 1}:${Log._getBnNumber(0)}`,
        gt: `${this.prefixes.pendingRefs}:${Log._getBnNumber(version)}`
      })
        .on('data', data => {
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


  async addProof (term, proof) { //do we need to
    return await this.db.put(`${this.prefixes.term}:${Log._getBnNumber(term)}`, proof);
  }

  async getProof (term) {
    try {
      return await this.db.get(`${this.prefixes.term}:${Log._getBnNumber(term)}`);
    } catch (e) {
      return null;
    }

  }

  async getFirstEntryByTerm (term) {
    try {
      let item = await this.db.get(`${this.prefixes.term}:${Log._getBnNumber(term)}`);
      return await this.db.get(`${this.prefixes.logs}:${Log._getBnNumber(item.index)}`);
    } catch (err) {
      return {
        index: 0,
        hash: _.fill(new Array(32), 0).join(''),
        term: this.node.term
      };
    }
  }

  async getLastEntryByTerm (term) {
    try {
      let headEntry = await this.getFirstEntryByTerm(term);

      if (headEntry.index === 0)
        return headEntry;

      if (!headEntry)
        return {
          index: 0,
          hash: _.fill(new Array(32), 0).join(''),
          term: this.node.term
        };

      return await this.db.get(`${this.prefixes.logs}:${Log._getBnNumber(headEntry.index - 1)}`);

    } catch (err) {
      return {
        index: 0,
        hash: _.fill(new Array(32), 0).join(''),
        term: this.node.term
      };
    }
  }

  /**
   * getEntriesAfter - Get all the entries after a specific index
   *
   * @param {number} index Index that entries must be greater than
   * @return {Promise<Entry[]>} returns all entries
   * @public
   */
  async getEntriesAfter (index, limit) {
    const entries = [];

    let query = {
      gt: `${this.prefixes.logs}:${Log._getBnNumber(index)}`,
      lt: `${this.prefixes.logs + 1}:${Log._getBnNumber(0)}`
    };

    if (limit)
      query.limit = limit;

    return await new Promise((resolve, reject) => {
      this.db.createReadStream(query)
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

  /**
   * removeEntriesAfter - Removes all entries after a given index
   *
   * @async
   * @param {Number} index Index to use to find all entries after
   * @return {Promise<void>} Returns once all antries are removed
   * @public
   */
  async removeEntriesAfter (index) { //todo implement keep last term
    const entries = await this.getEntriesAfter(index);

    for (let entry of entries)
      await this.db.del(`${this.prefixes.logs}:${Log._getBnNumber(entry.index)}`);


    let {term: lastTerm, index: lastIndex} = await this.getLastInfo();
    this.node.term = lastIndex === 0 ? 0 : lastTerm;

    this.emit(this.eventTypes.LOGS_UPDATED);
  }

  /**
   * get - Gets an entry at the specified index position
   *
   * @param {type} index Index position of entry
   * @return {Promise<Entry>} Promise of found entry returns NotFoundError if does not exist
   * @public
   */
  async get (index) {
    try {
      return await this.db.get(`${this.prefixes.logs}:${Log._getBnNumber(index)}`);
    } catch (err) {
      return null;
    }

  }


  async getByHash (hash) {
    try {
      let refIndex = await this.db.get(`${this.prefixes.refs}:${hash}`);
      return await this.get(refIndex);
    } catch (err) {
      return null;
    }

  }

  /**
   * getLastInfo - Returns index, term of the last entry in the long along with
   * the committedIndex
   *
   * @async
   * @return {Promise<Object>} Last entries index, term and committedIndex
   */
  async getLastInfo () {
    const {index, term, hash, createdAt} = await this.getLastEntry();

    return {
      index,
      term,
      hash,
      createdAt
    };
  }

  /**
   * getLastEntry - Returns last entry in the log
   *
   * @return {Promise<Entry>} returns {index: 0, term: node.term} if there are no entries in the log
   */
  async getLastEntry () {
    return await new Promise((resolve, reject) => {
      let entry = {
        index: 0,
        hash: _.fill(new Array(32), 0).join(''),
        term: 0,
        committed: true,
        createdAt: Date.now()
      };


      this.db.createReadStream({
        reverse: true,
        limit: 1,
        lt: `${this.prefixes.logs + 1}:${Log._getBnNumber(0)}`,
        gte: `${this.prefixes.logs}:${Log._getBnNumber(0)}`
      })
        .on('data', data => {
          entry = data.value;
        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          resolve(entry);
        });
    });
  }

  /**
   * getEntryInfoBefore - Gets the index and term of the previous entry along with the log's committedIndex
   * If there is no item before it returns {index: 0}
   *
   *
   * @async
   * @param {Entry} entry
   * @return {Promise<object>} {index, term, committedIndex}
   */
  async getEntryInfoBefore (entry) {
    const {index, term, hash, createdAt} = await this.getEntryBefore(entry);

    return {
      index,
      term,
      hash,
      createdAt
    };
  }

  /**
   * getEntryBefore - Get entry before the specified entry
   * If there is no item before it returns {index: 0}
   *
   * @async
   * @param {Entry} entry
   *
   * @return {Promise<Entry>}
   */
  getEntryBefore (entry) {
    const defaultInfo = {
      index: 0,
      term: this.node.term,
      hash: _.fill(new Array(32), 0).join('')
    };
    // We know it is the first entry, so save the query time
    if (entry.index === 1)
      return Promise.resolve(defaultInfo);


    return new Promise((resolve, reject) => {
      let hasResolved = false;

      this.db.createReadStream({
        reverse: true,
        limit: 1,
        lt: `${this.prefixes.logs}:${Log._getBnNumber(entry.index)}`,
        gt: `${this.prefixes.logs}:${Log._getBnNumber(0)}`
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

  async commandAck (index, publicKey) {
    let entry = await this.get(index);

    if (!entry)
      return {
        responses: []
      };

    const entryIndex = entry.responses.findIndex(resp => resp.publicKey === publicKey);
    // node hasn't voted yet. Add response
    if (entryIndex === -1)
      entry.responses.push({
        publicKey,
        ack: true
      });


    await this.put(entry);

    return entry;
  }


  /**
   * commit - Set the entry to committed
   *
   * @async
   * @param {number} Index index
   *
   * @return {Promise<entry>}
   */
  async commit (index) {

    const entry = await this.db.get(`${this.prefixes.logs}:${Log._getBnNumber(index)}`);

    entry.committed = true;
    this.committedIndex = entry.index;

    return await this.put(entry);
  }

  /**
   * getUncommittedEntriesUpToIndex - Returns all entries before index that have not been committed yet
   *
   * @param {number} index Index value to find all entries up to
   * @return {Promise<Entry[]}
   * @private
   */
  getUncommittedEntriesUpToIndex (index) {
    return new Promise((resolve, reject) => {
      const entries = [];

      this.db.createReadStream({
        gt: `${this.prefixes.logs}:${Log._getBnNumber(this.committedIndex)}`,
        lte: `${this.prefixes.logs}:${Log._getBnNumber(index)}`
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

  /**
   * end - Log end
   * Called when the node is shutting down
   *
   * @return {boolean} Successful close.
   * @private
   */
  end () {
    return this.db.close();
  }
}


module.exports = Log;
