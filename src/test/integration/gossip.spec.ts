import Promise from 'bluebird';
import {expect} from 'chai';
import {fork} from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';

describe('gossip tests', (ctx = {mokkas: []}) => {

  beforeEach(() => {

    const mokkas: any = [];

    ctx.keys = [];

    for (let i = 0; i < 5; i++) {
      const node = crypto.createECDH('secp256k1');
      node.generateKeys();
      ctx.keys.push({
        privateKey: node.getPrivateKey().toString('hex'),
        publicKey: node.getPublicKey().toString('hex')
      });
    }
    for (let index = 0; index < ctx.keys.length; index++) {
      const instance = fork(path.join(__dirname, 'workers/MokkaWorker.ts'), [], {
        execArgv: ['-r', 'ts-node/register']
      });

      mokkas.push(instance);
      instance.send({
        args: [
          {
            index,
            keys: ctx.keys
          }
        ],
        type: 'init'
      });
    }

    const kill = () => {
      for (const instance of mokkas)
        instance.kill();
    };

    process.on('SIGINT', kill);
    process.on('SIGTERM', kill);
    ctx.mokkas = mokkas;

  });

  it('should replicate the log via gossip and append once most nodes online', async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});

    await Promise.all([
      new Promise((res) => {
        ctx.mokkas[0].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[1].publicKey);
          res();
        });
      }),
      new Promise((res) => {
        ctx.mokkas[1].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[0].publicKey);
          res();
        });
      }),
      ctx.mokkas[0].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B', {
          nonce: Date.now(),
          value: Date.now().toString()
        }],
        type: 'push'
      }),
      ctx.mokkas[1].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51', {
          nonce: Date.now() + 1,
          value: (Date.now() + 1).toString()
        }],
        type: 'push'
      })
    ]);

    for (const mokka of ctx.mokkas.slice(2))
      mokka.send({type: 'connect'});

    const infoAwaitPromises = ctx.mokkas.slice(0, 2).map((mokka: any) =>
      new Promise((res) => {
        const timeoutId = setInterval(() => {
          mokka.send({type: 'info'});
        }, 1000);
        mokka.on('message', (msg: any) => {

          if (msg.type !== 'info' || msg.args[0].index !== 2)
            return;

          clearInterval(timeoutId);
          res(msg.args[0]);
        });
      })
    );

    await Promise.all(infoAwaitPromises);
    await Promise.delay(1000);

    const newPendingStatePromises: Array<Promise<[]>> = ctx.mokkas.slice(0, 2).map((mokka: any) =>
      new Promise((res) => {
        mokka.send({type: 'pendings'});

        mokka.on('message', (msg: any) => {
          if (msg.type !== 'pendings')
            return;
          res(msg.args[0]);
        });
      })
    );

    const newPendingStates = await Promise.all(newPendingStatePromises);

    for (const state of newPendingStates)
      expect(state.length).to.eq(0);
  });

  it('should handle the log after emitter death', async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});

    await Promise.all([
      new Promise((res) => {
        ctx.mokkas[0].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[1].publicKey);
          res();
        });
      }),
      new Promise((res) => {
        ctx.mokkas[1].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[0].publicKey);
          res();
        });
      }),
      ctx.mokkas[0].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B', {
          nonce: Date.now(),
          value: Date.now().toString()
        }],
        type: 'push'
      }),
      ctx.mokkas[1].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51', {
          nonce: Date.now() + 1,
          value: (Date.now() + 1).toString()
        }],
        type: 'push'
      })
    ]);

    const pendingStatePromises: Array<Promise<[]>> = ctx.mokkas.slice(0, 2).map((mokka: any) =>
      new Promise((res) => {
        mokka.send({type: 'pendings'});

        mokka.on('message', (msg: any) => {
          if (msg.type !== 'pendings')
            return;
          res(msg.args[0]);
        });
      })
    );

    const pendingStates = await Promise.all(pendingStatePromises);

    for (const state of pendingStates)
      expect(state.length).to.eq(1);

    ctx.mokkas[1].kill();

    for (const mokka of ctx.mokkas.slice(2))
      mokka.send({type: 'connect'});

    await new Promise((res) => {
      const timeoutId = setInterval(() => {
        ctx.mokkas[0].send({type: 'info'});
      }, 1000);
      ctx.mokkas[0].on('message', (msg: any) => {

        if (msg.type !== 'info' || msg.args[0].index !== 2)
          return;

        clearInterval(timeoutId);
        res(msg.args[0]);
      });
    });

    const newPendingState: any = await new Promise((res) => {
      ctx.mokkas[0].send({type: 'pendings'});

      ctx.mokkas[0].on('message', (msg: any) => {
        if (msg.type !== 'pendings')
          return;
        res(msg.args[0]);
      });
    });

    expect(newPendingState.length).to.eq(0);
  });

  it('should remove logs from bad nodes', async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].kill();

    ctx.mokkas[1] = fork(path.join(__dirname, 'workers/MokkaWorker.ts'), [], {
      execArgv: ['-r', 'ts-node/register']
    });

    const fakeKeys = ctx.keys.slice(0);
    const node = crypto.createECDH('secp256k1');
    node.generateKeys();
    fakeKeys[1] = {
      privateKey: node.getPrivateKey().toString('hex'),
      publicKey: node.getPublicKey().toString('hex')
    };

    ctx.mokkas[1].send({
      args: [
        {
          index: 1,
          keys: fakeKeys,
          publicKey: ctx.keys[1].publicKey
        }
      ],
      type: 'init'
    });

    ctx.mokkas[1].send({type: 'connect'});

    await Promise.all([
      await Promise.delay(2000),
      new Promise((res) => {
        ctx.mokkas[1].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[0].publicKey);
          res();
        });
      }),
      ctx.mokkas[0].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B', {
          nonce: Date.now(),
          value: Date.now().toString()
        }],
        type: 'push'
      }),
      ctx.mokkas[1].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51', {
          nonce: Date.now() + 1,
          value: (Date.now() + 1).toString()
        }],
        type: 'push'
      })
    ]);

    const pendingStatePromises: Array<Promise<[]>> = ctx.mokkas.slice(0, 2).map((mokka: any) =>
      new Promise((res) => {
        mokka.send({type: 'pendings_all'});

        mokka.on('message', (msg: any) => {
          if (msg.type !== 'pendings_all')
            return;
          res(msg.args[0]);
        });
      })
    );

    const pendingStates = await Promise.all(pendingStatePromises);

    await Promise.delay(3000);

    expect(pendingStates[0].length).to.eq(1);
    expect(pendingStates[1].length).to.eq(2);

    for (const mokka of ctx.mokkas.slice(2))
      mokka.send({type: 'connect'});

    await new Promise((res) => {
      const timeoutId = setInterval(() => {
        ctx.mokkas[0].send({type: 'info'});
      }, 1000);
      ctx.mokkas[0].on('message', (msg: any) => {

        if (msg.type !== 'info' || msg.args[0].index !== 1)
          return;

        clearInterval(timeoutId);
        res(msg.args[0]);
      });
    });

    const newPendingState: any = await new Promise((res) => {
      ctx.mokkas[0].send({type: 'pendings_all'});

      ctx.mokkas[0].on('message', (msg: any) => {
        if (msg.type !== 'pendings_all')
          return;
        res(msg.args[0]);
      });
    });

    expect(newPendingState.length).to.eq(0);
  });

  afterEach(async () => {
    for (const node of ctx.mokkas)
      node.kill();

    await Promise.delay(1000);
  });

});
