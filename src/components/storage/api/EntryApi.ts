import prefixes from '../constants/prefixes';
import {IStorageInterface} from '../interfaces/IStorageInterface';
import {EntryModel} from '../models/EntryModel';
import getBnNumber from '../utils/getBnNumber';
import {StateModel} from "../models/StateModel";

class EntryApi {

  private db: IStorageInterface;

  constructor(db: IStorageInterface) {
    this.db = db;
  }

  public async get(index: number): Promise<EntryModel | null> {
    try {
      return await this.db.get(`${prefixes.logs}:${getBnNumber(index)}`);
    } catch (err) {
      return null;
    }
  }

  public getAfterList(index: number, limit: number = null): Promise<EntryModel[]> {
    const result: EntryModel[] = [];

    return new Promise((resolve, reject) => {

      const query = {
        gt: `${prefixes.logs}:${getBnNumber(index)}`,
        limit,
        lt: `${prefixes.logs + 1}:${getBnNumber(0)}`
      };

      if (limit)
        query.limit = limit;

      this.db.createReadStream(query)
        .on('data', (data: { value: EntryModel }) => {
          result.push(data.value);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .on('end', () => {
          resolve(result);
        });
    });
  }

  public async put(entry: EntryModel): Promise<void> {
    await this.db.put(`${prefixes.logs}:${getBnNumber(entry.index)}`, entry);
  }

  public async compact(): Promise<void> {

    const state: StateModel = await this.db.get(`${prefixes.states}`);
    const keys = new Set<string>();

    for (let index = state.index; index > 0; index--) {
      const log = await this.get(index);
      if (!log)
        continue;

      const isExist = keys.has(log.log.key);
      if (isExist) {
        await this.db.del(`${prefixes.logs}:${getBnNumber(index)}`);
      } else {
        keys.add(log.log.key);
      }
    }
  }
}

export {EntryApi};
