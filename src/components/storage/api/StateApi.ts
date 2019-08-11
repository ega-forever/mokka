import prefixes from '../constants/prefixes';
import {IStorageInterface} from '../interfaces/IStorageInterface';
import {StateModel} from '../models/StateModel';
import {EntryApi} from './EntryApi';

class StateApi {

  private db: IStorageInterface;
  private entryApi: EntryApi;

  constructor(db: IStorageInterface) {
    this.db = db;
    this.entryApi = new EntryApi(db);
  }

  public async setState(publicKey: string, state: StateModel): Promise<void> {
    await this.db.put(`${prefixes.states}:${publicKey}`, state);
  }

  public async getInfo(publicKey: string): Promise<StateModel> {
    try {
      return await this.db.get(`${prefixes.states}:${publicKey}`);
    } catch (e) {
      return new StateModel();
    }
  }

}

export {StateApi};
