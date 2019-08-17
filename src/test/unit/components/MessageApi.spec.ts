import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import * as nacl from 'tweetnacl';
import TCPMokka from '../../../implementation/TCP';
import {MessageApi} from '../../../components/consensus/api/MessageApi';

describe('MessageApi tests', (ctx = {}) => {

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

  it('check message size', async () => {

    const messageApi = new MessageApi(ctx.nodes[0]);

    const packet = await messageApi.packet(1, ctx.nodes[1].publicKey, null);

    console.log(Buffer.from(JSON.stringify(packet)).byteLength);

  });


});
