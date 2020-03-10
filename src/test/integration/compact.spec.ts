import Promise from 'bluebird';
import {expect} from 'chai';
import {fork} from 'child_process';
import crypto from 'crypto';
import * as _ from 'lodash';
import * as path from 'path';

describe('logs compact tests (5 nodes)', async (ctx = {}, nodesCount = 5) => {
  beforeEach(async () => {

    const mokkas: any = [];

    ctx.keys = [];

    for (let i = 0; i < nodesCount; i++) {
      const node = crypto.createECDH('secp256k1');
      node.generateKeys();

      if (node.getPrivateKey().toString('hex').length !== 64) {
        i--;
        continue;
      }

      ctx.keys.push({
        privateKey: node.getPrivateKey().toString('hex'),
        publicKey: node.getPublicKey('hex', 'compressed')
      });
    }

    for (let index = 0; index < ctx.keys.length; index++) {
      const instance = fork(path.join(__dirname, 'workers/MokkaWorker.ts'), [], {
        execArgv: ['-r', 'ts-node/register']
      });

      mokkas.push(instance);
      instance.send({
        args: [
          {
            index,
            keys: ctx.keys
          }
        ],
        type: 'init'
      });
    }

    const kill = () => {
      for (const instance of mokkas)
        instance.kill();
    };

    process.on('SIGINT', kill);
    process.on('SIGTERM', kill);
    ctx.mokkas = mokkas;
  });

  afterEach(async () => {
    for (const node of ctx.mokkas) {
      node.kill();
    }
    await Promise.delay(1000);
  });

  it(`should replicate the queued logs on several nodes and append them (${nodesCount} nodes)`, async () => {

    for (const mokka of ctx.mokkas)
      mokka.send({type: 'connect'});

    const uniqueRecords = new Map<string, { nonce: number, value: string }>();

    for (let i = 0; i < 100; i++) {

      const key = '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51' + Math.round(Math.random() * 10);
      const value = {
        nonce: i,
        value: Date.now().toString()
      };

      uniqueRecords.set(key, value);
      ctx.mokkas[0].send({
        args: [key, value],
        type: 'push'
      });
    }

    const infoAwaitPromises = ctx.mokkas.map((mokka: any) =>
      new Promise((res) => {
        const timeoutId = setInterval(() => {
          mokka.send({type: 'info'});
        }, 1000);

        mokka.on('message', (msg: any) => {

          if (msg.type !== 'info' || msg.args[0].index !== 100)
            return;

          clearInterval(timeoutId);
          res(msg.args[0]);

        });
      })
    );

    const infos = await Promise.all(infoAwaitPromises);
    expect(_.chain(infos).map((infos: any) => infos.hash).uniq().size().value()).to.eq(1);

    const compactAwaitPromises = ctx.mokkas.map((mokka: any) =>
      new Promise((res) => {
        mokka.send({type: 'compact'});

        mokka.on('message', (msg: any) => {

          if (msg.type !== 'compacted')
            return;

          res();
        });
      })
    );

    await Promise.all(compactAwaitPromises);

    for (const mokka of ctx.mokkas) {
      const logs: Array<{ key: string, value: { nonce: number, value: string } }> = await new Promise((res) => {
        mokka.send({type: 'logs_all'});

        mokka.on('message', (msg: any) => {

          if (msg.type !== 'logs')
            return;

          res(msg.args[0]);
        });
      });

      expect(logs.length).to.eq(uniqueRecords.size);

      for (const log of logs) {
        const uniqueEntry = uniqueRecords.get(log.key);
        expect(uniqueEntry.value).to.eq(log.value.value);
        expect(uniqueEntry.nonce).to.eq(log.value.nonce);
      }

    }

  });

});
