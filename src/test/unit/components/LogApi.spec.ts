import Promise from 'bluebird';
import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import {expect} from 'chai';
import {createHmac} from 'crypto';
import crypto from 'crypto';
import {LogApi} from '../../../components/consensus/api/LogApi';
import NodeStates from '../../../components/consensus/constants/NodeStates';
import {Mokka} from '../../../components/consensus/main';
import {convertKeyPairToRawSecp256k1} from '../../../components/consensus/utils/keyPair';
import {StateModel} from '../../../components/storage/models/StateModel';
import TCPMokka from '../../../implementation/TCP';

describe('LogApi tests', (ctx = {}) => {

  beforeEach(async () => {

    ctx.keys = [];

    ctx.nodes = [];

    for (let i = 0; i < 3; i++) {
      const node = crypto.createECDH('secp256k1');
      node.generateKeys();
      ctx.keys.push({
        privateKey: node.getPrivateKey().toString('hex'),
        publicKey: node.getPublicKey().toString('hex')
      });
    }

    for (let index = 0; index < 3; index++) {
      const instance = new TCPMokka({
        address: `tcp://127.0.0.1:2000/${ctx.keys[index].publicKey}`,
        electionMax: 300,
        electionMin: 100,
        gossipHeartbeat: 100,
        heartbeat: 50,
        logger: bunyan.createLogger({name: 'mokka.logger', level: 60}),
        privateKey: ctx.keys[index].privateKey,
        proofExpiration: 5000
      });

      for (let i = 0; i < 3; i++)
        if (i !== index)
          instance.nodeApi.join(`tcp://127.0.0.1:${2000 + i}/${ctx.keys[i].publicKey}`);

      ctx.nodes.push(instance);
    }

  });

  it('should add new record on push to gossip', async () => {

    const logApi = new LogApi(ctx.nodes[0]);

    const key = `test_${Date.now()}`;
    const value = Date.now();

    logApi.push(key, value);

    const pendings = (ctx.nodes[0] as Mokka).gossip.ownState.getPendingLogs();
    expect(pendings.length).to.be.eq(1);
    expect(pendings[0].log.key).to.be.eq(key);
    expect(pendings[0].log.value).to.be.eq(value);
    (ctx.nodes[0] as Mokka).disconnect();
  });

  it('should accept new record to commit (when leader state)', async () => {

    const logApi = new LogApi(ctx.nodes[0]);
    (ctx.nodes[0] as Mokka).setState(NodeStates.LEADER, 1, null);

    const key = `test_${Date.now()}`;
    const value = Date.now();

    logApi.push(key, value);

    logApi.runLoop();

    await new Promise((res) => {
      (logApi as any)._broadcast = res;
    });

    await Promise.delay(1000);

    // todo
    logApi.stop();
    await (ctx.nodes[0] as Mokka).disconnect();
  });

  it('should recommit record (when leader state)', async () => {

    const logApi = new LogApi(ctx.nodes[0]);

    const leaderNode = (ctx.nodes[0] as Mokka);
    leaderNode.setState(NodeStates.LEADER, 1, leaderNode.publicKey);

    const leaderState = new StateModel(10, '123', 1);
    leaderNode.setLastLogState(leaderState);

    const followerNode = leaderNode.nodes.get(ctx.nodes[1].publicKey);
    followerNode.setState(NodeStates.FOLLOWER, 1, leaderNode.publicKey);

    const followerState = new StateModel(9, '234', 1);
    followerNode.setLastLogState(followerState);

    for (let i = 1; i <= 10; i++) {
      const hash = createHmac('sha256', 'data' + i).digest('hex');
      const sign = crypto.createSign('sha256');
      sign.update(hash);

      const keyPair = crypto.createECDH('secp256k1');
      keyPair.setPrivateKey(Buffer.from(ctx.keys[1].privateKey, 'hex'));
      const rawKeyPair = convertKeyPairToRawSecp256k1(keyPair);

      const signature = sign.sign(rawKeyPair.privateKey).toString('hex');

      await leaderNode.getDb().getLog().save(
        leaderNode.publicKey,
        hash,
        1,
        signature);
    }

    logApi.runLoop();

    const data: Map<string, { node: Mokka, index: number }> = await new Promise((res) => {
      const nodes = new Map<string, { node: Mokka, index: number }>();
      (logApi as any).broadcastInRange = (node, index) => {
        nodes.set(node.publicKey, {node, index});
        if (nodes.size === 2)
          res(nodes);
      };
    });

    logApi.stop();
    await (ctx.nodes[0] as Mokka).disconnect();

    expect(data.get(followerNode.publicKey).index).to.be.eq(10);

    const followerState2 = new StateModel(0, '123', 1);
    followerNode.setLastLogState(followerState2);

    logApi.runLoop();

    const data2: Map<string, { node: Mokka, index: number }> = await new Promise((res) => {
      const nodes = new Map<string, { node: Mokka, index: number }>();
      (logApi as any).broadcastInRange = (node, index) => {
        nodes.set(node.publicKey, {node, index});
        if (nodes.size === 2)
          res(nodes);
      };
    });
    logApi.stop();

    await (ctx.nodes[0] as Mokka).disconnect();
    expect(data2.get(followerNode.publicKey).index).to.be.eq(10);
  });

  // todo speed test on append new logs (check timers)

  afterEach(async () => {
    await Promise.delay(100);
  });

});
