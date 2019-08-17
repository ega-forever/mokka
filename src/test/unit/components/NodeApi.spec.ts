import Promise from 'bluebird';
import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import {expect} from 'chai';
import {createHmac} from 'crypto';
import * as nacl from 'tweetnacl';
import {LogApi} from '../../../components/consensus/api/LogApi';
import messageTypes from '../../../components/consensus/constants/MessageTypes';
import NodeStates from '../../../components/consensus/constants/NodeStates';
import {Mokka} from '../../../components/consensus/main';
import {StateModel} from '../../../components/storage/models/StateModel';
import TCPMokka from '../../../implementation/TCP';

describe('NodeApi tests', (ctx = {}) => {

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
  });

  it('should not pass promote, because no votes received', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;
    candidateNode.setState(NodeStates.FOLLOWER, 2, '');

    await candidateNode.nodeApi.promote();

    expect(candidateNode.state).to.be.eq(NodeStates.FOLLOWER);
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
  });

  it('another candidate took leader role during promote', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;
    const leaderNode = ctx.nodes[1] as Mokka;
    candidateNode.setState(NodeStates.FOLLOWER, 2, '');

    const pr = candidateNode.nodeApi.promote();

    await new Promise((res) => setTimeout(res, 50));

    candidateNode.setState(NodeStates.FOLLOWER, 3, leaderNode.publicKey);

    await pr;

    console.log(candidateNode.term);
    expect(candidateNode.term).to.be.eq(3);
  });


  afterEach(async () => {
    await Promise.delay(1000);
  });

});
