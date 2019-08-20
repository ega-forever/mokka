import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import * as crypto from 'crypto';
import {MessageApi} from '../../../components/consensus/api/MessageApi';
import TCPMokka from '../../../implementation/TCP';

describe('MessageApi tests', (ctx = {}) => {

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
        privateKey: ctx.keys[index].privateKey
      });

      for (let i = 0; i < 3; i++)
        if (i !== index)
          instance.nodeApi.join(`tcp://127.0.0.1:${2000 + i}/${ctx.keys[i].publicKey}`);

      ctx.nodes.push(instance);
    }

  });

  // todo implement tests for checking max size
  
  it('check message size', async () => {

    const messageApi = new MessageApi(ctx.nodes[0]);

    const packet = await messageApi.packet(1, ctx.nodes[1].publicKey, null);

    console.log(Buffer.from(JSON.stringify(packet)).byteLength);

  });


});
