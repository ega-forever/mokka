import * as fs from 'fs-extra';
import * as lineReader from 'line-reader';
import * as _ from 'lodash';
import {Semaphore} from 'semaphore';
import semaphore = require('semaphore');
import prefixes from '../constants/prefixes';
import {IApplierFunctionInterface} from '../interfaces/IApplierFunctionInterface';
import {ICBFunctionInterface} from '../interfaces/ICBFunctionInterface';
import {RSMStateModel} from '../models/RSMStateModel';
import {StateModel} from '../models/StateModel';
import {TriggerStateModel} from '../models/TriggerStateModel';
import {EntryApi} from './EntryApi';

class StateApi {

  private sem: Semaphore;
  private db: any;
  private entryApi: EntryApi;
  private prefixes: any = {
    permanent: 2,
    state: 3,
    temp: 1
  };

  constructor(db: any) {
    this.db = db;
    this.sem = semaphore(1);
    this.entryApi = new EntryApi(db);
  }

  public getApplierFuncs(index: number, hash: string, term: number): { get: any, put: any, del: any } {

    return {
      del: this.del.bind(this, index, hash, term),
      get: this.get.bind(this),
      put: this.put.bind(this, index, hash, term)
    };

  }

  public async get(key: string): Promise<string | null> {
    try {
      return await this.db.get(`${prefixes.triggers}.${this.prefixes.permanent}:${key}`);
    } catch (err) {
      return null;
    }
  }

  public async getLastApplied(): Promise<TriggerStateModel> {
    try {
      return await this.db.get(`${prefixes.triggers}.${this.prefixes.state}`);
    } catch (err) {
      return new TriggerStateModel({});
    }
  }

  public async put(
    index: number,
    hash: string,
    term: number,
    key: string,
    value: string,
    rewrite = false
  ): Promise<void> {

    await new Promise((res) => {

      this.sem.take(async () => {
        const lastApplied = await this.getLastApplied();

        if (!rewrite && lastApplied.index >= index)
          return;

        await this.db.put(`${prefixes.triggers}.${this.prefixes.permanent}:${key}`, value);
        await this.db.put(`${prefixes.triggers}.${this.prefixes.state}`, {
          hash,
          index,
          term
        });
        res();
        this.sem.leave();
      });

    });
  }

  public async del(index: number, hash: string, term: number, key: string, rewrite = false): Promise<void> {

    await new Promise((res) => {

      this.sem.take(async () => {
        const lastApplied = await this.getLastApplied();

        if (!rewrite && lastApplied.index >= index)
          return;

        await this.db.del(`${prefixes.triggers}.${this.prefixes.permanent}:${key}`);
        await this.db.put(`${prefixes.triggers}.${this.prefixes.state}`, {
          hash,
          index,
          term
        });
        res();
        this.sem.leave();
      });

    });

  }

  public async getAll(confirmed = false, skip = 0, limit = 100, applier: IApplierFunctionInterface) {

    const state: RSMStateModel = await new Promise((resolve, reject) => {

      const stateModel = new RSMStateModel({});

      let count = 0;

      this.db.createReadStream({
        gt: `${prefixes.triggers}.${this.prefixes.permanent}`,
        lt: `${prefixes.triggers}.${this.prefixes.permanent + 1}`
      })
        .on('data', (data: { key: Buffer, value: string }) => {

          count++;

          if (count < skip || count - skip > limit)
            return;

          const key = data.key.toString().replace(`${prefixes.triggers}.${this.prefixes.permanent}:`, '');
          stateModel.put(key, data.value);
        })
        .on('error', (err: Error) => {
          reject(err);
        })
        .on('end', () => {
          resolve(stateModel);
        });
    });

    if (confirmed)
      return state.getState();

    const info = await this.getInfo();
    const entries = await this.entryApi.getAfterList(info.index);

    for (const entry of entries)
      await applier(entry.log, state);

    return state.getState();
  }

  public async _getNextTrigger(): Promise<{ key: Buffer, value: string }> {

    return await new Promise((res) => {
      let trigger: { key: Buffer, value: string };

      this.db.createKeyStream({
        gt: prefixes.triggers,
        limit: 1,
        lt: prefixes.triggers + 1
      }).on('data', async (data: { key: Buffer, value: string }) => {
        trigger = data;
      }).on('end', () => res(trigger));

    });
  }

  public async dropAll() {

    let trigger = await this._getNextTrigger();

    while (trigger) {
      await this.db.del(trigger.key);
      trigger = await this._getNextTrigger();
    }

    await this.entryApi.removeAfter(0);
    await this.db.del(prefixes.states);
  }

  public async takeSnapshot(path: string): Promise<void> {
    await new Promise((res) => {
      this.sem.take(async () => {

        await fs.remove(path);
        const info = await this.getLastApplied();
        const dataWs = fs.createWriteStream(path, {flags: 'a'});
        dataWs.write(`${JSON.stringify(info)}\n`);

        await new Promise((resolve, reject) => {

          this.db.createReadStream({
            gt: `${prefixes.triggers}.${this.prefixes.permanent}`,
            lt: `${prefixes.triggers}.${this.prefixes.permanent + 1}`
          })
            .on('data', (data: { key: Buffer, value: string }) => {
              const key = data.key.toString().replace(`${prefixes.triggers}.${this.prefixes.permanent}:`, '');
              dataWs.write(`${JSON.stringify({key, value: data.value})}\n`);
            })
            .on('error', (err: Error) => {
              reject(err);
            })
            .on('end', () => {
              dataWs.end();
              resolve();
            });
        });

        this.sem.leave();
        res();
      });
    });
  }

  public async appendSnapshot(path: string) {

    await this.dropAll();

    const info = await new Promise((res, rej) => {

      let header: any;

      // @ts-ignore
      lineReader.eachLine(path, async (line: string, last: string, callback: ICBFunctionInterface) => {

        if (!header) {
          header = JSON.parse(line);
          return callback(null, null);
        }

        const trigger = JSON.parse(line);
        await this.db.put(`${prefixes.triggers}.${this.prefixes.permanent}:${trigger.key}`, trigger.value);

        callback(null, null);
      }, (err: Error | null) => err ? rej() : res(header));
    });

    if (!info)
      return;

    const defaultState = _.merge({committed: true, created: Date.now()}, info);

    await this.db.put(prefixes.states, defaultState);
    await this.db.put(`${prefixes.triggers}.${this.prefixes.state}`, info);
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
