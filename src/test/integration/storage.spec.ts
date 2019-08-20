import Promise from 'bluebird';
import bunyan from 'bunyan';
import {expect} from 'chai';
import * as crypto from 'crypto';
import {createHmac} from 'crypto';
import fs from 'fs-extra';
// @ts-ignore
import leveldown from 'leveldown';
// @ts-ignore
import * as _ from 'lodash';
import * as path from 'path';
import {EntryModel} from '../../components/storage/models/EntryModel';
import {StateModel} from '../../components/storage/models/StateModel';
import TCPMokka from '../../implementation/TCP';

describe('storage tests', (ctx = {}) => {

  beforeEach(async () => {

    const node = crypto.createECDH('secp256k1');
    node.generateKeys();

    const dbPath = path.join(__dirname, '../../../', 'dump', 'test.db');

    fs.removeSync(dbPath);

    ctx.mokka = new TCPMokka({
      address: `tcp://127.0.0.1:2000/${node.getPublicKey().toString('hex')}`,
      electionMax: 1000,
      electionMin: 300,
      gossipHeartbeat: 200,
      heartbeat: 200,
      logger: bunyan.createLogger({name: 'mokka.logger', level: 60}),
      privateKey: node.getPrivateKey().toString('hex'),
      storage: leveldown(`${dbPath}_db`)
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

      const state = new StateModel(9999,
        createHmac('sha256', 'data' + 99999).digest('hex')
      );

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
