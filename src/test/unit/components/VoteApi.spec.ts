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
import {MessageApi} from '../../../components/consensus/api/MessageApi';
import MessageTypes from '../../../components/consensus/constants/MessageTypes';
import {VoteApi} from '../../../components/consensus/api/VoteApi';

describe('VoteApi tests', (ctx = {}) => {

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

  it('should check vote', async () => {

    const candidateNode = ctx.nodes[0] as Mokka;

    candidateNode.setState(NodeStates.CANDIDATE, 2, '');

    const candidateMessageApi = new MessageApi(candidateNode);
    const followerNode = ctx.nodes[1] as Mokka;
    const followerVoteApi = new VoteApi(followerNode);

    const packet = await candidateMessageApi.packet(MessageTypes.VOTE, followerNode.publicKey, {
      share: '123'
    });

    const start = Date.now();
    const result = await followerVoteApi.vote(packet);
    expect(result.data.signature).to.not.be.undefined;
    expect(Date.now() - start).to.be.lt(10);

  });

  afterEach(async () => {
    await Promise.delay(1000);
  });

});
