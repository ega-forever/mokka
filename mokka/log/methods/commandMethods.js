const _ = require('lodash'),
  semaphore = require('semaphore')(1),
  MerkleTools = require('merkle-tools'),
  getBnNumber = require('../../utils/getBnNumber'),
  restorePubKey = require('../../utils/restorePubKey');


class CommandMethods {

  constructor (log) {
    this.log = log;
  }


  async save (command, term, signature, index, checkHash) {

    return await new Promise((res, rej) => {
      semaphore.take(async () => {

        if (!command || _.isEmpty(command)) {
          semaphore.leave();
          return rej({code: 0, message: 'command can\'t be empty'});
        }


        const owner = restorePubKey(command, signature);

        const {index: lastIndex, hash: lastHash} = await this.log.entry.getLastInfo();


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
              publicKey: owner
            }
          ],
          shares: [],
          minShares: 0,
          signature,
          command
        };

        if (entry.owner !== this.log.node.publicKey)
          entry.responses.push({
            publicKey: this.log.node.publicKey // start with vote from leader
          });


        await this.log.entry._put(entry);
        res(entry);
        semaphore.leave();

      });
    });
  }

  async ack (index, publicKey) {
    let entry = await this.log.entry.get(index);

    if (!entry)
      return {
        responses: []
      };

    const entryIndex = entry.responses.findIndex(resp => resp.publicKey === publicKey);
    // node hasn't voted yet. Add response
    if (entryIndex === -1)
      entry.responses.push({publicKey});


    await this.log.entry._put(entry);
    return entry;
  }

  async commit (index) {

    const entry = await this.log.db.get(`${this.log.prefixes.logs}:${getBnNumber(index)}`);

    entry.committed = true;
    this.log.committedIndex = entry.index;

    await this.log.entry._put(entry);
  }

}


module.exports = CommandMethods;
