const encode = require('encoding-down'),
  _ = require('lodash'),
  semaphore = require('semaphore')(1),
  MerkleTools = require('merkle-tools'),
  levelup = require('levelup');


class Log {

  constructor (node, {adapter = require('memdown')}, schedulerTimeout = 10000) {
    this.node = node;
    this.committedIndex = 0;
    this.db = levelup(encode(adapter(), {valueEncoding: 'json', keyEncoding: 'binary'}));
    /*    this.scheduler = setInterval(async () => {

          let {index} = await this.getLastInfo();//todo check quorum (replicated factor)
          let metas = await this.getMetaEntriesAfter();

          for (let meta of metas) {
            if (meta.committedExecuted && meta.executed + 10 < index && meta.committedReserve && meta.committedTask) {
              await this.db.del(meta.executed);
              await this.db.del(meta.reserved);
              await this.db.del(meta.task);
              continue;
            }

            if (!meta.executed && meta.reserved && meta.committedReserve && meta.committedTask && meta.reserved + 10 < index && Date.now() - meta.timeout > meta.created)
              await this.db.del(meta.reserved);
          }

        }, schedulerTimeout)*/
  }


  async saveCommand (command, term, index, checkHash) {

    return await new Promise((res, rej) => {
      semaphore.take(async () => {

        if (!command || _.isEmpty(command)) {
          semaphore.leave();
          return rej({code: 0, message: 'task can\'t be empty'});
        }


        const {index: lastIndex, hash: lastHash} = await this.getLastInfo();

        if (_.isNumber(index) && index !== 0 && index <= lastIndex) {
          semaphore.leave();
          return rej({code: 0, message: 'can\'t rewrite chain!'});
        }


        if (!index)
          index = lastIndex + 1;


        const merkleTools = new MerkleTools();
        merkleTools.addLeaf(lastHash);

        merkleTools.addLeaf(JSON.stringify(command), true);
        merkleTools.makeTree();

        let generatedHash = merkleTools.getMerkleRoot().toString('hex');

        if(checkHash && generatedHash !== checkHash){
          semaphore.leave();
          return rej({code: 0, message: 'can\'t wrong hash!'});
        }



        const entry = {
          term: term,
          index: index,
          hash: generatedHash,
          committed: false,
          responses: [{
            publicKey: this.node.publicKey, // start with vote from leader
            ack: true
          }],
          shares: [],
          minShares: 0,
          command
        };

        await this.put(entry);
        res(entry);
        semaphore.leave();

      })
    });
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
    return await this.db.put(entry.index, entry);
  }

  async isReserved (index) {

    let reserved = false;

    return await new Promise((resolve, reject) => {
      this.db.createReadStream({gt: index})
        .on('data', data => {
          if (data.value.command.reserve === index)
            reserved = true;
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve(reserved);
        })
    });

  }


  /**
   * getEntriesAfter - Get all the entries after a specific index
   *
   * @param {number} index Index that entries must be greater than
   * @return {Promise<Entry[]>} returns all entries
   * @public
   */
  async getEntriesAfter (index) {
    const entries = [];
    return await new Promise((resolve, reject) => {
      this.db.createReadStream({gt: index})
        .on('data', data => {
          entries.push(data.value);
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve(entries);
        })
    });

  }


  async getMetaEntriesAfter (index, limit) {
    let entries = {};
    return await new Promise((resolve, reject) => {
      this.db.createReadStream({gt: index, limit: limit})
        .on('data', data => {

          if (data.value.command.task) {
            _.set(entries, `${data.value.index}.task`, data.value.index);
            _.set(entries, `${data.value.index}.created`, data.value.command.created);
            _.set(entries, `${data.value.index}.committedTask`, data.value.committed);

          }

          if (_.isNumber(data.value.command.reserve)) {

            _.set(entries, `${data.value.command.reserve}.reserved`, data.value.index);
            _.set(entries, `${data.value.command.reserve}.timeout`, data.value.command.timeout);
            _.set(entries, `${data.value.command.reserve}.committedReserve`, data.value.committed);

          }

          if (_.isNumber(data.value.command.executed))
            _.set(entries, `${data.value.command.executed}.executed`, data.value.index);
          _.set(entries, `${data.value.command.executed}.committedExecuted`, data.value.committed);
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          entries = _.chain(entries)
            .values()
            .filter(entity => _.isNumber(entity.task))
            .value();

          resolve(entries);
        })
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
  async removeEntriesAfter (index) {
    const entries = await this.getEntriesAfter(index);
    return Promise.all(entries.map(entry => {
      return this.db.del(entry.index);
    }));
  }

  async removeEntriesAfterLastCheckpoint (pubKey, logOwnerPubKey) {
    /*    const entries = await this.getEntriesAfter(index);
        return Promise.all(entries.map(entry => {
          return this.db.del(entry.index);
        }));*/

    let index = await new Promise((resolve, reject) => {
      let item = 0;//todo make rule

      this.db.createReadStream({reverse: true})
        .on('data', data => {

          if (item)
            return;

          if(data.value.responses.length === 1)
            return;

          console.log(data.value.responses)
          let foundPub = _.find(data.value.responses, {publicKey: pubKey, ack: true});
          let foundOwnerPub = _.find(data.value.responses, {publicKey: logOwnerPubKey, ack: true});

          if (foundPub && foundOwnerPub)
            index = data.value.index;
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve(item);
        });
    });

    console.log('stage: ', index)

    if (index)
      return await this.removeEntriesAfter(index);


  }

  /**
   * has - Checks if entry exists at index
   *
   * @async
   * @param {number} index Index position to check if entry exists
   * @return {boolean} Boolean on whether entry exists at index
   * @public
   */
  async has (index) {
    try {
      const entry = await this.db.get(index);
      return true
    } catch (err) {
      return false;
    }
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
      return await this.db.get(index);
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
    const {index, term, hash} = await this.getLastEntry();

    return {
      index,
      term,
      hash,
      committedIndex: this.committedIndex
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
        term: this.node.term
      };

      this.db.createReadStream({reverse: true, limit: 1})
        .on('data', data => {
          entry = data.value;
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve(entry);
        })
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
    const {index, term, hash} = await this.getEntryBefore(entry);

    return {
      index,
      term,
      hash,
      committedIndex: this.committedIndex
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
    if (entry.index === 1) {
      return Promise.resolve(defaultInfo);
    }

    return new Promise((resolve, reject) => {
      let hasResolved = false;

      this.db.createReadStream({
        reverse: true,
        limit: 1,
        lt: entry.index
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
          if (!hasResolved) {
            // Returns empty index if there is no items
            // before entry or log is empty
            resolve(defaultInfo);
          }
        });
    });
  }

  async commandAck (index, publicKey) {
    let entry = await this.get(index);

    if(!entry)
      return {
        responses: []
      };

    const entryIndex = await entry.responses.findIndex(resp => resp.publicKey === publicKey);
    // node hasn't voted yet. Add response
    if (entryIndex === -1) {
      entry.responses.push({
        publicKey,
        ack: true
      });
    }

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

    const entry = await this.db.get(index);

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
      let hasResolved = false;
      const entries = [];

      this.db.createReadStream({
        gt: this.committedIndex,
        lte: index
      })
        .on('data', data => {
          if (!data.value.committed) {
            entries.push(data.value);
          }
        })
        .on('error', err => {
          reject(err)
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

  /*  async appendShare (index, share, peer) {
      let entry;
      try {
        entry = await this.get(index);
      } catch (err) {
        return {
          shares: []
        }
      }

      if (!entry.shares.includes(share)) {
        entry.shares.push({share: share, peer: peer});
      }

      await this.put(entry);

      return entry;
    }


    async setMinShare (index, minShares) {
      let entry;
      try {
        entry = await this.get(index);
      } catch (err) {
        return {}
      }

      entry.minShares = minShares;

      await this.put(entry);
      return entry;
    }


    async getFreeTasks () {
      const entities = await this.getMetaEntriesAfter();
      return _.chain(entities).reject(entity =>
        entity.executed || (entity.reserved && Date.now() - entity.timeout < entity.created)
      ).map(entity => entity.task).value();
    }

    async remove (index) {
      return this.db.del(index);
    }*/

}

/*process.on('unhandledRejection', err=>{
  console.log(err);
  process.exit(0)
})*/

module.exports = Log;
