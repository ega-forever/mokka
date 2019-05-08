import Promise from 'bluebird';
import bunyan from 'bunyan';
import {expect} from 'chai';
import {createHmac} from 'crypto';
import fs from 'fs-extra';
// @ts-ignore
import leveldown from 'leveldown';
// @ts-ignore
import * as _ from 'lodash';
import * as path from 'path';
import {EntryModel} from '../components/storage/models/EntryModel';
import {StateModel} from '../components/storage/models/StateModel';
import TCPMokka from '../implementation/TCP';

describe('storage tests', (ctx = {}) => {

  beforeEach(async () => {

    // tslint:disable-next-line
    const key = 'f7954a52cb4e6cb8a83ed0d6150a3dd1e4ae2c150054660b14abbdc23e16262b7b85cee8bf60035d1bbccff5c47635733b9818ddc8f34927d00df09c1da80b15';
    const dbPath = path.join('./', 'dump', 'test.db');

    fs.removeSync(dbPath);

    ctx.mokka = new TCPMokka({
      address: `tcp://127.0.0.1:2000/${key.substring(64, 128)}`,
      electionMax: 1000,
      electionMin: 300,
      gossipHeartbeat: 200,
      heartbeat: 200,
      logger: bunyan.createLogger({name: 'mokka.logger', level: 60}),
      privateKey: key,
      storage: leveldown(`${path.join(__dirname, '../..', 'dump', 'test.db')}_db`)
    });

    await Promise.delay(500);

  });

  it('should add 2000 new logs for linear time', async () => {

    const deltas = await Promise.mapSeries([1, 2], async () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        const hash = createHmac('sha256', 'data' + i).digest('hex');

        const entry = new EntryModel({
          hash,
          index: i
        });
        await ctx.mokka.getDb().getEntry().put(entry);
      }

      return Date.now() - start;
    });

    expect(deltas[0] > deltas[1] ?
      ((deltas[1] - deltas[0]) / deltas[0]) :
      ((deltas[0] - deltas[1]) / deltas[1])
    ).to.be.lt(0.2);
  });

  it('should add 1000 new logs, random access them for linear time', async () => {

    const deltas = await Promise.mapSeries([1, 2], async () => {
      for (let i = 0; i < 1000; i++) {
        const hash = createHmac('sha256', 'data' + i).digest('hex');

        const entry = new EntryModel({
          hash,
          index: i
        });
        await ctx.mokka.getDb().getEntry().put(entry);
      }

      const start = Date.now();
      await ctx.mokka.getDb().getEntry().get(_.random(0, 1000));
      return Date.now() - start;
    });

    expect(deltas[0]).to.be.lt(10);
    expect(deltas[1]).to.be.lt(10);
  });

  it('should add 1000 new logs, random access last info for linear time', async () => {

    const deltas = await Promise.mapSeries([1, 2], async () => {
      for (let i = 0; i < 1000; i++) {
        const hash = createHmac('sha256', 'data' + i).digest('hex');

        const entry = new EntryModel({
          hash,
          index: i
        });
        await ctx.mokka.getDb().getEntry().put(entry);
      }

      const start = Date.now();
      await ctx.mokka.getDb().getState().getInfo();
      return Date.now() - start;
    });

    expect(deltas[0]).to.be.lt(10);
    expect(deltas[1]).to.be.lt(10);
  });

  it('should add 10000 new logs, random access random list for linear time', async () => {

    const deltas = await Promise.mapSeries([1, 2], async (num) => {
      for (let i = 0; i < 10000; i++) {
        const hash = createHmac('sha256', 'data' + i).digest('hex');

        const entry = new EntryModel({
          hash,
          index: i
        });
        await ctx.mokka.getDb().getEntry().put(entry);
      }

      const start = Date.now();
      await ctx.mokka.getDb().getEntry().getAfterList(_.random(3000 * num, 6000 * num), 10);
      return Date.now() - start;
    });

    expect(deltas[0]).to.be.lt(100);
    expect(deltas[1]).to.be.lt(100);
  });

  it('should add 100000 new logs, random access uncommitted list for linear time', async () => {

    const deltas = await Promise.mapSeries([1, 2], async (num) => {
      for (let i = 0; i < 100000; i++) {
        const hash = createHmac('sha256', 'data' + i).digest('hex');

        const entry = new EntryModel({
          hash,
          index: i
        });
        await ctx.mokka.getDb().getEntry().put(entry);
      }

      const start = Date.now();
      const randomIndex = _.random(3000 * num, 6000 * num);

      const state = new StateModel({
        committedIndex: randomIndex - 10,
        hash: createHmac('sha256', 'data' + 99999).digest('hex'),
        index: 99999
      });

      await ctx.mokka.getDb().getState().setState(state);

      await ctx.mokka.getDb().getEntry().getAfterList(randomIndex, 10);
      return Date.now() - start;
    });

    expect(deltas[0]).to.be.lt(10);
    expect(deltas[1]).to.be.lt(10);
  });

  afterEach(async () => {
    ctx.mokka.disconnect();
    await Promise.delay(1000);
  });

});
