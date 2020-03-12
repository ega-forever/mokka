import Promise from 'bluebird';
import {expect} from 'chai';
import {fork} from 'child_process';
import crypto from 'crypto';
import * as path from 'path';
import NodeStates from '../../../consensus/constants/NodeStates';

export function testSuite(ctx: any = {}, nodesCount: number = 0) {

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
        privateKey: node.getPrivateKey('hex'),
        publicKey: node.getPublicKey('hex', 'compressed')
      });
    }

    for (let index = 0; index < ctx.keys.length; index++) {
      const instance = fork(path.join(__dirname, '../workers/MokkaWorker.ts'), [], {
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
  });

  it(`should find leader, once most nodes online (51%)`, async () => {

    const promises = [];
    const initialNodesAmount = Math.ceil(ctx.mokkas.length / 2) + 1;

    let leaderPubKey = null;

    for (let i = 0; i < initialNodesAmount; i++) {
      ctx.mokkas[i].send({type: 'connect'});

      const promise = new Promise((res) => {
        ctx.mokkas[i].on('message', (msg: any) => {
          if (msg.type !== 'state' || (msg.args[0] !== NodeStates.LEADER && !leaderPubKey))
            return;

          if (msg.args[0] === NodeStates.LEADER) {
            leaderPubKey = msg.args[1];
            return res(msg.args[0]);
          }

          if (msg.args[1] === leaderPubKey) {
            return res(msg.args[0]);
          }

        });
      });
      promises.push(promise);
    }

    const result = await Promise.all(promises);
    expect(result.filter((r) => r === NodeStates.LEADER).length === 1);
  });

}
