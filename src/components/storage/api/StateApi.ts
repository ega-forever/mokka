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

  public async setState(state: StateModel): Promise<void> {
    await this.db.put(`${prefixes.states}`, state);
  }

  public async getInfo(): Promise<StateModel> {
    try {
      return await this.db.get(`${prefixes.states}`);
    } catch (e) {
      return new StateModel();
    }
  }

}

export {StateApi};
