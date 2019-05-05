import {Semaphore} from 'semaphore';
import semaphore = require('semaphore');
import prefixes from '../constants/prefixes';
import {IStorageInterface} from '../interfaces/IStorageInterface';
import {StateModel} from '../models/StateModel';
import {EntryApi} from './EntryApi';

class StateApi {

  private sem: Semaphore;
  private db: IStorageInterface;
  private entryApi: EntryApi;

  constructor(db: any) {
    this.db = db;
    this.sem = semaphore(1);
    this.entryApi = new EntryApi(db);
  }

  public async setState(state: StateModel): Promise<void> {
    await this.db.put(prefixes.states.toString(), state);
  }

  public async getInfo(): Promise<StateModel> {
    try {
      return await this.db.get(prefixes.states.toString());
    } catch (e) {
      return new StateModel({});
    }
  }

}

export {StateApi};
