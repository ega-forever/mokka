import Promise from 'bluebird';
import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import {expect} from 'chai';
import {createHmac} from 'crypto';
import * as nacl from 'tweetnacl';
import {AppendApi} from '../../../components/consensus/api/AppendApi';
import {MessageApi} from '../../../components/consensus/api/MessageApi';
import messageTypes from '../../../components/consensus/constants/MessageTypes';
import NodeStates from '../../../components/consensus/constants/NodeStates';
import {StateModel} from '../../../components/storage/models/StateModel';
import TCPMokka from '../../../implementation/TCP';

describe('AppendApi tests', (ctx = {}) => {

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


    // todo mock fake peers

  });


  it('should append 1000 records for linear time', async () => {

    const appendApi = new AppendApi(ctx.nodes[0]);
    const messageApi = new MessageApi(ctx.nodes[1]);

    for (let i = 1; i <= 1000; i++) {
      const hash = createHmac('sha256', 'data' + i).digest('hex');
      const signature = Buffer.from(
        nacl.sign.detached(
          Buffer.from(hash),
          Buffer.from(ctx.keys[1], 'hex')
        )
      ).toString('hex');

      const entry = await ctx.nodes[1].getDb().getLog().save(
        ctx.nodes[1].publicKey,
        hash,
        1,
        signature);

      const appendPacket = await messageApi.packet(messageTypes.APPEND, ctx.nodes[0].publicKey, entry);

      appendPacket.state = NodeStates.LEADER;
      appendPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);

      const start = Date.now();
      const reply = await appendApi.append(appendPacket);
      expect(reply[0].type === messageTypes.APPEND_ACK);
      expect(Date.now() - start).to.be.lt(100); // todo should be 10
    }
  });

  it('should ignore append, once we receive wrong index', async () => {

    const appendApi = new AppendApi(ctx.nodes[0]);
    const messageApi = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(ctx.keys[1], 'hex')
      )
    ).toString('hex');

    const entry = await ctx.nodes[1].getDb().getLog().save(
      ctx.nodes[1].publicKey,
      hash,
      1,
      signature);

    const appendPacket = await messageApi.packet(messageTypes.APPEND, ctx.nodes[0].publicKey, entry);

    appendPacket.state = NodeStates.LEADER;
    appendPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);
    appendPacket.data.index++;

    const reply = await appendApi.append(appendPacket);
    expect(reply.length === 0);


  });

  it('should send append_ack for the known entry', async () => {

    const appendApi = new AppendApi(ctx.nodes[0]);
    const messageApi = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(ctx.keys[1], 'hex')
      )
    ).toString('hex');

    const entry = await ctx.nodes[1].getDb().getLog().save(
      ctx.nodes[1].publicKey,
      hash,
      1,
      signature);

    const appendPacket = await messageApi.packet(messageTypes.APPEND, ctx.nodes[0].publicKey, entry);

    appendPacket.state = NodeStates.LEADER;
    appendPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);

    const reply = await appendApi.append(appendPacket);
    expect(reply[0].type === messageTypes.APPEND_ACK);

    const reply2 = await appendApi.append(appendPacket);
    expect(reply2[0].type === messageTypes.APPEND_ACK);

  });

  it('should ignore previous record (once current height is higher)', async () => {

    const appendApi = new AppendApi(ctx.nodes[0]);
    const messageApi = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(ctx.keys[1], 'hex')
      )
    ).toString('hex');

    const entry = await ctx.nodes[1].getDb().getLog().save(
      ctx.nodes[1].publicKey,
      hash,
      1,
      signature);

    const appendPacket = await messageApi.packet(messageTypes.APPEND, ctx.nodes[0].publicKey, entry);

    appendPacket.state = NodeStates.LEADER;
    appendPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);

    const reply = await appendApi.append(appendPacket);
    expect(reply[0].type === messageTypes.APPEND_ACK);

    appendPacket.data.index--;

    const reply2 = await appendApi.append(appendPacket);
    expect(reply2.length === 0);

  });

  it('should ignore error on trying save record with wrong hash', async () => {

    const appendApi = new AppendApi(ctx.nodes[0]);
    const messageApi = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(ctx.keys[1], 'hex')
      )
    ).toString('hex');

    const entry = await ctx.nodes[1].getDb().getLog().save(
      ctx.nodes[1].publicKey,
      hash,
      1,
      signature);

    const appendPacket = await messageApi.packet(messageTypes.APPEND, ctx.nodes[0].publicKey, entry);

    appendPacket.state = NodeStates.LEADER;
    appendPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);

    appendPacket.data.hash = hash;

    const reply = await appendApi.append(appendPacket);
    expect(reply.length === 0);
  });

  it('should ignore append ack on wrong peer', async () => {

    const appendApi = new AppendApi(ctx.nodes[0]);
    const messageApi = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');


    const fakePubKey = Buffer.from(nacl.sign.keyPair().secretKey).toString('hex').substr(64, 128);
    const appendPacket = await messageApi.packet(messageTypes.APPEND_ACK, ctx.nodes[0].publicKey);
    appendPacket.last = new StateModel(1, hash, 1);
    appendPacket.publicKey = fakePubKey;

    await appendApi.appendAck(appendPacket);
    expect(ctx.nodes[0].getLastLogState().index === 0);
  });

  it('should ignore append ack on wrong log', async () => {

    const appendApi = new AppendApi(ctx.nodes[0]);
    const messageApi = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');


    const appendPacket = await messageApi.packet(messageTypes.APPEND_ACK, ctx.nodes[0].publicKey);
    appendPacket.last = new StateModel(1, hash, 1);

    await appendApi.appendAck(appendPacket);
    expect(ctx.nodes[0].nodes.get(ctx.nodes[1].publicKey).getLastLogState().index === 0);
  });

  it('should append_ack and update state', async () => {

    const appendApiLeader = new AppendApi(ctx.nodes[0]);
    const messageApiLeader = new MessageApi(ctx.nodes[0]);

    const appendApiFollower = new AppendApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(ctx.keys[1], 'hex')
      )
    ).toString('hex');

    const entry = await ctx.nodes[0].getDb().getLog().save(
      ctx.nodes[0].publicKey,
      hash,
      1,
      signature);

    const appendPacket = await messageApiLeader.packet(messageTypes.APPEND, ctx.nodes[1].publicKey, entry);
    appendPacket.state = NodeStates.LEADER;
    appendPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);

    const replyAppend = await appendApiFollower.append(appendPacket);
    expect(replyAppend[0].type === messageTypes.APPEND_ACK);

    await appendApiLeader.appendAck(replyAppend[0]);

    const memoryState = ctx.nodes[0].nodes.get(ctx.nodes[1].publicKey).getLastLogState();

    expect(memoryState.index === 1);

    /*    expect(dbState.index === memoryState.index);
        expect(dbState.hash === memoryState.hash);
        expect(dbState.term === memoryState.term);
        expect(dbState.createdAt === memoryState.createdAt);*/

  });

  it('should send back error, in case height is out of bounds', async () => {

    const appendApiLeader = new AppendApi(ctx.nodes[0]);

    const messageApiFollower = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(ctx.keys[1], 'hex')
      )
    ).toString('hex');

    const entry = await ctx.nodes[0].getDb().getLog().save(
      ctx.nodes[0].publicKey,
      hash,
      1,
      signature);

    const failPacket = await messageApiFollower.packet(messageTypes.APPEND_FAIL, ctx.nodes[0].publicKey, {index: entry.index + 1});
    failPacket.state = NodeStates.FOLLOWER;
    failPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);

    const reply = await appendApiLeader.appendFail(failPacket);

    expect(reply[0].type === messageTypes.ERROR);
  });

  it('should resend log, in case of append_error', async () => {

    const appendApiLeader = new AppendApi(ctx.nodes[0]);

    const messageApiFollower = new MessageApi(ctx.nodes[1]);

    const hash = createHmac('sha256', 'data').digest('hex');
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(ctx.keys[1], 'hex')
      )
    ).toString('hex');

    const entry = await ctx.nodes[0].getDb().getLog().save(
      ctx.nodes[0].publicKey,
      hash,
      1,
      signature);

    const failPacket = await messageApiFollower.packet(messageTypes.APPEND_FAIL, ctx.nodes[0].publicKey, {index: entry.index});
    failPacket.state = NodeStates.FOLLOWER;
    failPacket.last = new StateModel(entry.index, entry.hash, entry.term, entry.createdAt);

    const reply = await appendApiLeader.appendFail(failPacket);

    expect(reply[0].type === messageTypes.APPEND);
    expect(reply[0].data.index === entry.index);
  });


  afterEach(async () => {
    await Promise.delay(1000);
  });

});
