import Promise from 'bluebird';
import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import {expect} from 'chai';
import * as nacl from 'tweetnacl';
import TCPMokka from '../../../implementation/TCP';
import {LogApi} from '../../../components/consensus/api/LogApi';
import {Mokka} from '../../../components/consensus/main';
import NodeStates from '../../../components/consensus/constants/NodeStates';
import {StateModel} from '../../../components/storage/models/StateModel';
import {createHmac} from 'crypto';
import messageTypes from '../../../components/consensus/constants/MessageTypes';

describe('LogApi tests', (ctx = {}) => {

  beforeEach(async () => {

    ctx.keys = [];

    ctx.nodes = [];

    for (let index = 0; index < 3; index++) {
      ctx.keys.push(Buffer.from(nacl.sign.keyPair().secretKey).toString('hex'));
    }

    for (let index = 0; index < 3; index++) {
      const instance = new TCPMokka({
        address: `tcp://127.0.0.1:2000/${ctx.keys[index].substring(64, 128)}`,
        electionMax: 1000,
        electionMin: 300,
        gossipHeartbeat: 200,
        heartbeat: 200,
        logger: bunyan.createLogger({name: 'mokka.logger', level: 60}),
        privateKey: ctx.keys[index]
      });

      for (let i = 0; i < 3; i++)
        if (i !== index)
          instance.nodeApi.join(`tcp://127.0.0.1:${2000 + i}/${ctx.keys[i].substring(64, 128)}`);

      ctx.nodes.push(instance);
    }

  });

  it('should add new record on push to gossip', async () => {

    const logApi = new LogApi(ctx.nodes[0]);

    const key = `test_${Date.now()}`;
    const value = Date.now();

    logApi.push(key, value);

    const pendings = (ctx.nodes[0] as Mokka).gossip.ownState.getPendingLogs();
    expect(pendings.length === 1);
    expect(pendings[0].log.key === key);
    expect(pendings[0].log.value === value);
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
      const signature = Buffer.from(
        nacl.sign.detached(
          Buffer.from(hash),
          Buffer.from(ctx.keys[1], 'hex')
        )
      ).toString('hex');

      await leaderNode.getDb().getLog().save(
        leaderNode.publicKey,
        hash,
        1,
        signature);
    }

    logApi.runLoop();

    const data: { node: Mokka, index: number } = await new Promise((res) => {
      (logApi as any).broadcastInRange = (node, index) => res({node, index});
    });

    await Promise.delay(1000);

    logApi.stop();
    await (ctx.nodes[0] as Mokka).disconnect();

    expect(data.index === 10);
    expect(data.node.publicKey === followerNode.publicKey);

    const followerState2 = new StateModel(0, '123', 1);
    followerNode.setLastLogState(followerState2);

    logApi.runLoop();

    const data2: { node: Mokka, index: number } = await new Promise((res) => {
      (logApi as any).broadcastInRange = (node, index) => res({node, index});
    });

    await Promise.delay(1000);

    logApi.stop();
    await (ctx.nodes[0] as Mokka).disconnect();

    expect(data2.index === 10);
    expect(data2.node.publicKey === followerNode.publicKey);


  });

  it('should pull bad record', async () => {

    const leaderNode = ctx.nodes[0] as Mokka;
    leaderNode.setState(NodeStates.LEADER, 1, null);

    const logApi = new LogApi(leaderNode);

    const key = `123_${Date.now()}`;
    (leaderNode.gossip.ownState as any).attrs.set(key, {value: 'custom', number: 1});

    logApi.runLoop();

    const hash = await new Promise((res) => {
      leaderNode.gossip.pullPending = res;
    });

    logApi.stop();
    await leaderNode.disconnect();

    expect(hash === key);
  });

  // todo speed test on append new logs (check timers)



  afterEach(async () => {
    await Promise.delay(1000);
  });

});
