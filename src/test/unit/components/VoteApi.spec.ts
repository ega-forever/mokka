import Promise from 'bluebird';
import bunyan from 'bunyan';
import {expect} from 'chai';
import crypto from 'crypto';
import {MessageApi} from '../../../consensus/api/MessageApi';
import {VoteApi} from '../../../consensus/api/VoteApi';
import MessageTypes from '../../../consensus/constants/MessageTypes';
import NodeStates from '../../../consensus/constants/NodeStates';
import {Mokka} from '../../../consensus/main';
import TCPMokka from '../../../implementation/TCP';

describe('VoteApi tests', (ctx = {}) => {

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

  it('should check vote', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;

    candidateNode.setState(NodeStates.CANDIDATE, 2, '');

    const candidateMessageApi = new MessageApi(candidateNode);
    const followerNode = ctx.nodes[1] as Mokka;
    const followerVoteApi = new VoteApi(followerNode);

    const packet = await candidateMessageApi.packet(MessageTypes.VOTE, {
      nonce: Date.now()
    });

    const start = Date.now();
    const result = await followerVoteApi.vote(packet);
    // tslint:disable-next-line:no-unused-expression
    expect(result[0].data.signatures).to.not.be.undefined;
    expect(Date.now() - start).to.be.lt(10);

  });

  afterEach(async () => {
    await Promise.delay(1000);
  });

});
