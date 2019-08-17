import Promise from 'bluebird';
import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import {expect} from 'chai';
import * as nacl from 'tweetnacl';
import TCPMokka from '../../../implementation/TCP';
import {Mokka} from '../../../components/consensus/main';
import NodeStates from '../../../components/consensus/constants/NodeStates';
import MessageTypes from '../../../components/consensus/constants/MessageTypes';
import EventTypes from '../../../components/shared/constants/EventTypes';

describe('TimeCtrl tests', (ctx = {}) => {

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

  it('should check timeout', async () => {

    const node = ctx.nodes[0] as Mokka;
    expect(node.heartbeat).to.be.lt(node.timer.timeout());
  });

  it('should check heartbeat (as leader, should send ack)', async () => {

    const node = ctx.nodes[0] as Mokka;
    node.setState(NodeStates.LEADER, 1, null);


    const start = Date.now();
    node.timer.heartbeat();

    const packet: any = await new Promise((res) => {
      (node.timer as any).messageApi.message = res;
    });
    const end = Date.now();

    expect((end - start) - node.heartbeat).to.be.lt(5);
    expect(packet.type).to.be.eq(MessageTypes.ACK);
  });

  it('should check heartbeat (as follower, should promote)', async () => {

    const node = ctx.nodes[0] as Mokka;
    node.setState(NodeStates.FOLLOWER, 1, null);


    const start = Date.now();
    const timeout = node.timer.timeout();
    node.timer.heartbeat(timeout);

    await new Promise((res) => {
      (node.timer as any).nodeApi.promote = res;
    });
    const end = Date.now();

    expect((end - start) - timeout).to.be.lt(5);
  });

  it('should run infinite heartbeat when leader (delay in send message, slow heartbeat)', async () => {

    const node = ctx.nodes[0] as Mokka;
    node.setState(NodeStates.LEADER, 1, null);

    const start = Date.now();
    node.timer.heartbeat();

    const ends: any = await new Promise((res) => {

      const arr = [];

      (node.timer as any).messageApi.message = async () => {
        arr.push(Date.now());

        if (arr.length === 5 * node.nodes.size) {
          node.removeAllListeners(EventTypes.HEARTBEAT_TIMEOUT);
          res(arr);
        }

        await new Promise((res) => setTimeout(res, 50));
      };
    });


    for (let index = 0; index < ends.length; index += node.nodes.size) {

      if (index === 0) {
        expect((ends[index] - start)).to.be.gt(node.heartbeat + 5);
      } else {
        expect(ends[index] - ends[index - node.nodes.size]).to.be.gt(node.heartbeat + 5);
      }
    }

  });

});
