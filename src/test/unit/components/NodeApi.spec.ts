import Promise from 'bluebird';
import bunyan from 'bunyan';
import {expect} from 'chai';
import crypto from 'crypto';
import NodeStates from '../../../consensus/constants/NodeStates';
import {Mokka} from '../../../consensus/main';
import TCPMokka from '../../../implementation/TCP';

describe('NodeApi tests', (ctx = {}) => {

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

  it('should pass promote, once received votes', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;
    candidateNode.setState(NodeStates.FOLLOWER, 2, '');

    await Promise.all([
      candidateNode.nodeApi.promote(),
      new Promise((res) => {
        setTimeout(() => {
          candidateNode.setState(NodeStates.LEADER, 2, candidateNode.publicKey);
          res();
        }, 150);
      })
    ]);

    expect(candidateNode.state).to.be.eq(NodeStates.LEADER);
    await candidateNode.disconnect();
  });

  it('should not pass promote, because no votes received', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;
    candidateNode.setState(NodeStates.FOLLOWER, 2, '');

    await candidateNode.nodeApi.promote();

    expect(candidateNode.state).to.be.eq(NodeStates.FOLLOWER);
    await candidateNode.disconnect();
  });

  it('concurrent promoting (called concurrently several times)', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;
    candidateNode.setState(NodeStates.FOLLOWER, 2, '');

    const pr1 = candidateNode.nodeApi.promote();
    const pr2 = candidateNode.nodeApi.promote();
    const pr3 = candidateNode.nodeApi.promote();
    const pr4 = candidateNode.nodeApi.promote();

    expect(candidateNode.term).to.be.eq(3);
    await Promise.all([pr1, pr2, pr3, pr4]);

    expect(candidateNode.term).to.be.eq(2);
    await candidateNode.disconnect();
  });

  it('another candidate took leader role during promote', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;
    const leaderNode = ctx.nodes[1] as Mokka;
    candidateNode.setState(NodeStates.FOLLOWER, 2, '');

    const pr = candidateNode.nodeApi.promote();

    await new Promise((res) => setTimeout(res, 50));

    candidateNode.setState(NodeStates.FOLLOWER, 3, leaderNode.publicKey);

    await pr;

    expect(candidateNode.term).to.be.eq(3);
    await candidateNode.disconnect();
  });

  afterEach(async () => {
    await Promise.delay(1000);
  });

});
