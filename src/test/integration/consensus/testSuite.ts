import assert from 'assert';
import Promise from 'bluebird';
import {fork} from 'child_process';
import crypto from 'crypto';
import * as _ from 'lodash';
import * as path from 'path';
import NodeStates from '../../../consensus/constants/NodeStates';

// tslint:disable-next-line:max-line-length
export function testSuite(ctx: any = {}, nodesCount: number = 0, mokkaType: string = 'TCP', crashModel: string = 'CFT') {

  beforeEach(async () => {

    const mokkas: any = [];

    ctx.keys = [];
    ctx.settings = {
      crashModel,
      electionTimeout: 1000,
      heartbeat: 300,
      proofExpiration: 5000
    };

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

    const mokkaTypes = {
      RPC: 'MokkaRPCWorker.ts',
      TCP: 'MokkaTCPWorker.ts'
    };

    for (let index = 0; index < ctx.keys.length; index++) {
      const instance = fork(path.join(__dirname, `../workers/${mokkaTypes[mokkaType]}`), [], {
        execArgv: ['-r', 'ts-node/register']
      });
      mokkas.push(instance);
      instance.send({
        args: [
          {
            index,
            keys: ctx.keys,
            settings: ctx.settings
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

  it(`should find leader, once most nodes online`, async () => {

    const promises = [];
    const initialNodesAmount = ctx.mokkas.length - Math.ceil(ctx.mokkas.length - 1) / (crashModel === 'CFT' ? 2 : 3);

    let leaderPubKey = null;

    for (let i = 0; i < initialNodesAmount; i++) {
      ctx.mokkas[i].send({type: 'connect'});

      const promise = new Promise((res) => {
        ctx.mokkas[i].on('message', (msg: any) => {
          if (msg.type !== 'state' || (msg.args[0] !== NodeStates.LEADER && !leaderPubKey))
            return;

          if (msg.args[0] === NodeStates.LEADER) {
            leaderPubKey = msg.args[1];
            return res({state: msg.args[0], publicKey: leaderPubKey, term: msg.args[2], index: msg.args[3]});
          }

          if (msg.args[1] === leaderPubKey) {
            return res({state: msg.args[0], publicKey: leaderPubKey, term: msg.args[2], index: msg.args[3]});
          }

        });
      });
      promises.push(promise);
    }

    // tslint:disable-next-line:max-line-length
    const result: { state: number, publicKey: string, term: number, index: number }[] = await Promise.all(promises);
    const leaderEventMap = result.reduce((acc, val) => {

      if (val.state !== NodeStates.LEADER) {
        return acc;
      }

      if (!acc.has(val.term)) {
        acc.set(val.term, []);
      }

      acc.get(val.term).push(val.index);
      return acc;
    }, new Map<number, number[]>());

    const maxTerm = _.max([...leaderEventMap.keys()]);
    const leaderIndex = leaderEventMap.get(maxTerm)[0];
    const timer = Date.now();

    await new Promise((res) => {
      ctx.mokkas[leaderIndex].on('message', (msg: any) => {
        if (msg.type !== 'state' || (msg.args[0] === NodeStates.LEADER))
          return;

        res();
      });
    });

    assert(Math.round(ctx.settings.proofExpiration / 2) <= Date.now() - timer);
  });

}
