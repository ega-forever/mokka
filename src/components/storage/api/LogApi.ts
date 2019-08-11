import MerkleTools = require('merkle-tools');
import {IStorageInterface} from '../interfaces/IStorageInterface';
import {EntryModel} from '../models/EntryModel';
import {StateModel} from '../models/StateModel';
import {EntryApi} from './EntryApi';
import {StateApi} from './StateApi';

class LogApi {

  private readonly db: IStorageInterface;
  private entryApi: EntryApi;
  private stateApi: StateApi;

  constructor(db: IStorageInterface) {
    this.db = db;
    this.entryApi = new EntryApi(this.db);
    this.stateApi = new StateApi(this.db);
  }

  public async save(
    publicKey: string,
    log: any,
    term: number,
    signature: string,
    index: number = null,
    hash: string = null
  ): Promise<EntryModel> {

    const {index: lastIndex, hash: lastHash} = await this.stateApi.getInfo(publicKey);

    if (Number.isInteger(index) && index !== 0 && index <= lastIndex) {
      return Promise.reject({
        code: 1,
        message: `can't rewrite chain (received ${index} while current is ${lastIndex})!`
      });
    }

    if (Number.isInteger(index) && index !== 0 && index !== lastIndex + 1) {
      return Promise.reject({
        code: 3,
        message: `can't apply logs not in direct order (received ${index} while current is ${lastIndex})!`
      });
    }

    if (!Number.isInteger(index))
      index = lastIndex + 1;

    const merkleTools = new MerkleTools();
    merkleTools.addLeaf(lastHash);

    merkleTools.addLeaf(JSON.stringify(log), true);
    merkleTools.makeTree();

    const generatedHash = merkleTools.getMerkleRoot().toString('hex');

    if (hash && generatedHash !== hash) {
      return Promise.reject({code: 2, message: 'can\'t save wrong hash!'});
    }

    const entry = new EntryModel({
      createdAt: Date.now(),
      hash: generatedHash,
      index,
      log,
      signature,
      term
    });

    await this.entryApi.put(entry);

    const state: StateModel = {
      createdAt: Date.now(),
      hash: entry.hash,
      index: entry.index,
      term: entry.term
    };
    await this.stateApi.setState(publicKey, state);

    return entry;
  }
}

export {LogApi};
