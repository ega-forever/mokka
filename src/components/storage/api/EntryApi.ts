import prefixes from '../constants/prefixes';
import {EntryModel} from '../models/EntryModel';
import getBnNumber from '../utils/getBnNumber';

class EntryApi {

  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  public async removeAfter(index: number): Promise<void> {

    const lastEntry = await this._getLastEntry();

    let entry = await this._getBefore(lastEntry.index + 1);

    while (entry.index > index) {
      await this.db.del(`${prefixes.logs}:${getBnNumber(entry.index)}`);

      const lastEntry = await this._getLastEntry();
      entry = await this._getBefore(lastEntry.index); // todo fix
    }

    //  let {term: lastTerm, index: lastIndex} = await this.getLastInfo();
    // this.log.node.term = lastIndex === 0 ? 0 : lastTerm; //todo call in code
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

  private async _getLastEntry(): Promise<EntryModel> {
    // @ts-ignore
    return await new Promise((resolve, reject) => {
      let entry = new EntryModel({});

      this.db.createReadStream({
        gte: `${prefixes.logs}:${getBnNumber(0)}`,
        limit: 1,
        lt: `${prefixes.logs + 1}:${getBnNumber(0)}`,
        reverse: true
      })
        .on('data', (data: { value: EntryModel }) => {
          entry = data.value;
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .on('end', () => {
          resolve(entry);
        });
    });
  }

  private async _getBefore(index: number): Promise<EntryModel> {

    // We know it is the first entry, so save the query time
    if (index === 1)
      return new EntryModel({});

    // @ts-ignore
    return new Promise((resolve, reject) => {
      let hasResolved = false;

      this.db.createReadStream({
        gt: `${prefixes.logs}:${getBnNumber(0)}`,
        limit: 1,
        lt: `${prefixes.logs}:${getBnNumber(index)}`,
        reverse: true
      })
        .on('data', (data: { value: EntryModel }) => {
          hasResolved = true;
          resolve(data.value);
        })
        .on('error', (err: Error) => {
          hasResolved = true;
          reject(err);
        })
        .on('end', () => {
          if (!hasResolved)
            resolve(new EntryModel({}));

        });
    });
  }

}

export {EntryApi};
