import * as _ from 'lodash';
// @ts-ignore
import * as MerkleTools from 'merkle-tools';
import * as semaphore from 'semaphore';
import {Semaphore} from 'semaphore';
import {EntryModel} from '../models/EntryModel';
import {StateModel} from '../models/StateModel';
import {EntryApi} from './EntryApi';
import {StateApi} from './StateApi';

class LogApi {

  private db: any;
  private entryApi: EntryApi;
  private stateApi: StateApi;
  private semaphore: Semaphore;

  constructor(db: any) {
    this.db = db;
    this.entryApi = new EntryApi(this.db);
    this.stateApi = new StateApi(this.db);
    this.semaphore = semaphore(1);
  }

  public async save(
    log: any,
    term: number,
    signature: string,
    responses: string[],
    index: number = null,
    hash: string = null
  ): Promise<EntryModel> {

    // @ts-ignore
    return await new Promise((res, rej) => {
      this.semaphore.take(async () => {

        const {index: lastIndex, hash: lastHash} = await this.stateApi.getInfo();

        if (_.isNumber(index) && index !== 0 && index <= lastIndex) {
          this.semaphore.leave();
          return rej({code: 1, message: `can't rewrite chain (received ${index} while current is ${lastIndex})!`});
        }

        if (_.isNumber(index) && index !== 0 && index !== lastIndex + 1) {
          this.semaphore.leave();
          return rej({
            code: 3,
            message: `can't apply logs not in direct order (received ${index} while current is ${lastIndex})!`
          });
        }

        if (!_.isNumber(index))
          index = lastIndex + 1;

        const merkleTools = new MerkleTools();
        merkleTools.addLeaf(lastHash);

        merkleTools.addLeaf(JSON.stringify(log), true);
        merkleTools.makeTree();

        const generatedHash = merkleTools.getMerkleRoot().toString('hex');

        if (hash && generatedHash !== hash) {
          this.semaphore.leave();
          return rej({code: 2, message: 'can\'t save wrong hash!'});
        }

        const entry = new EntryModel({
          committed: false,
          createdAt: Date.now(),
          hash: generatedHash,
          index,
          log,
          responses,
          signature,
          term
        });

        await this.entryApi.put(entry);

        const currentState = await this.stateApi.getInfo();

        if (entry.index > currentState.index) {
          const state: StateModel = {
            ..._.pick(entry, ['index', 'term', 'hash', 'createdAt']),
            committedIndex: currentState.committedIndex
          };
          await this.stateApi.setState(state);
        }

        res(entry);
        this.semaphore.leave();

      });
    });
  }

  public async ack(index: number, publicKeys: string[]): Promise<EntryModel> {
    const entry = await this.entryApi.get(index);

    if (!entry)
      return new EntryModel({});

    for (const publicKey of publicKeys) {
      const entryIndex = entry.responses.indexOf(publicKey);
      if (entryIndex === -1)
        entry.responses.push(publicKey);
    }

    await this.entryApi.put(entry);
    return entry;
  }

  public async commit(index: number): Promise<void> {

    const info = await this.stateApi.getInfo();

    if (info.committedIndex >= index)
      return;

    info.committedIndex = index;
    await this.stateApi.setState(info);
  }

}

export {LogApi};
