import Promise from 'bluebird';
import {expect} from 'chai';
import {fork} from 'child_process';
import crypto from 'crypto';
import * as _ from 'lodash';
import * as path from 'path';

export function testSuite(ctx: any = {}, nodesCount: number = 0) {

  beforeEach(async () => {

    const mokkas: any = [];

    ctx.keys = [];

    for (let i = 0; i < nodesCount; i++) {
      const node = crypto.createECDH('secp256k1');
      node.generateKeys();
      ctx.keys.push({
        privateKey: node.getPrivateKey('hex'),
        publicKey: node.getPublicKey('hex', 'compressed')
      });
    }

    for (let index = 0; index < ctx.keys.length; index++) {
      const instance = fork(path.join(__dirname, '../workers/MokkaWorker.ts'), [], {
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

  afterEach(async () => {
    for (const node of ctx.mokkas) {
      node.kill();
    }
  });

  it(`should replicate the log and append once most nodes online (${nodesCount} nodes)`, async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});

    await Promise.delay(500);

    await Promise.all([
      new Promise((res) => {
        const intervalPid = setInterval(async () => {
          ctx.mokkas[0].send({type: 'info'});

          ctx.mokkas[0].once('message', (msg: any) => {
            if (msg.type !== 'info' || msg.args[0].index !== 2)
              return;

            clearInterval(intervalPid);
            res();
          });
        }, 1000); // todo replace with event

        ctx.mokkas[0].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[1].publicKey);
          clearInterval(intervalPid);
          res();
        });
      }),
      new Promise((res) => {
        const intervalPid = setInterval(async () => {
          ctx.mokkas[1].send({type: 'info'});

          ctx.mokkas[1].once('message', (msg: any) => {
            if (msg.type !== 'info' || msg.args[0].index !== 2)
              return;

            clearInterval(intervalPid);
            res();
          });
        }, 1000); // todo replace with event

        ctx.mokkas[1].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[0].publicKey);
          clearInterval(intervalPid);
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

    for (let i = 2; i < ctx.mokkas.length; i++)
      ctx.mokkas[i].send({type: 'connect'});

    const gossipAwaitPromises = ctx.mokkas.slice(2).map((mokka: any) => {
      return new Promise((res) => {
        const intervalPid = setInterval(async () => {
          mokka.send({type: 'info'});

          mokka.once('message', (msg: any) => {
            if (msg.type !== 'info' || msg.args[0].index !== 2)
              return;

            clearInterval(intervalPid);
            res();
          });
        }, 1000); // todo replace with event

        let missed = 0;
        mokka.on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;

          expect(msg.args[0]).to.be.oneOf([ctx.keys[0].publicKey, ctx.keys[1].publicKey]);

          missed++;
          if (missed === 2) {
            clearInterval(intervalPid);
            res();
          }
        });
      });
    });

    await Promise.all(gossipAwaitPromises);

    const infoAwaitPromises = ctx.mokkas.map((mokka: any) =>
      new Promise((res) => {
        const timeoutId = setInterval(() => { // todo replace with event
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

    const infos = await Promise.all(infoAwaitPromises);
    expect(_.chain(infos).map((infos: any) => infos.hash).uniq().size().value()).to.eq(1);
  });

  it(`should be able to reach the consensus with 51% of nodes (${nodesCount} nodes)`, async () => {

    const quorum = Math.floor(ctx.mokkas.length / 2) + 1;

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});

    await Promise.all([
      new Promise((res) => {
        const intervalPid = setInterval(async () => {
          ctx.mokkas[0].send({type: 'info'});

          ctx.mokkas[0].once('message', (msg: any) => {
            if (msg.type !== 'info' || msg.args[0].index !== 2)
              return;

            clearInterval(intervalPid);
            res();
          });
        }, 1000); // todo replace with event

        ctx.mokkas[0].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[1].publicKey);
          clearInterval(intervalPid);
          res();
        });
      }),
      new Promise((res) => {
        const intervalPid = setInterval(async () => {
          ctx.mokkas[1].send({type: 'info'});

          ctx.mokkas[1].once('message', (msg: any) => {
            if (msg.type !== 'info' || msg.args[0].index !== 2)
              return;

            clearInterval(intervalPid);
            res();
          });
        }, 1000); // todo replace with event

        ctx.mokkas[1].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[0].publicKey);
          clearInterval(intervalPid);
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
          nonce: Date.now() + 1 + 'b',
          value: (Date.now() + 1).toString()
        }],
        type: 'push'
      })
    ]);

    const pendingState: any = await new Promise((res) => {
      ctx.mokkas[0].send({type: 'pendings_all'});

      ctx.mokkas[0].on('message', (msg: any) => {
        if (msg.type !== 'pendings_all')
          return;
        res(msg.args[0]);
      });
    });

    const pendingState2: any = await new Promise((res) => {
      ctx.mokkas[1].send({type: 'pendings_all'});

      ctx.mokkas[1].on('message', (msg: any) => {
        if (msg.type !== 'pendings_all')
          return;
        res(msg.args[0]);
      });
    });

    expect(pendingState.length).to.eq(2);
    expect(pendingState2.length).to.eq(2);

    ctx.mokkas[1].kill();

    for (const mokka of ctx.mokkas.slice(2, quorum + 1))
      mokka.send({type: 'connect'});

    const infoAwaitPromises = [ctx.mokkas[0], ...ctx.mokkas.slice(2, quorum + 1)].map((mokka: any, index: number) =>
      new Promise((res) => {
        const timeoutId = setInterval(() => {
          mokka.send({type: 'info'});
        }, 1000); // todo replace with event
        mokka.on('message', (msg: any) => {

          if (msg.type !== 'info' || msg.args[0].index !== 2)
            return;

          clearInterval(timeoutId);
          res(msg.args[0]);
        });
      })
    );

    const infos = await Promise.all(infoAwaitPromises);

    expect(_.chain(infos).map((infos: any) => infos.hash).uniq().size().value()).to.eq(1);
  });

  it(`validate the state machine (${nodesCount} nodes)`, async () => {

    for (const mokka of ctx.mokkas)
      mokka.send({type: 'connect'});

    const recordsCount = _.random(20, 50);

    for (let i = 0; i < recordsCount; i++)
      ctx.mokkas[0].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B', {
          nonce: Date.now() + i,
          value: Date.now().toString()
        }],
        type: 'push'
      });

    const recordsCount2 = _.random(20, 50);

    for (let i = 0; i < recordsCount2; i++)
      ctx.mokkas[1].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51', {
          nonce: Date.now() + i + 1,
          value: (Date.now() + i + 1).toString()
        }],
        type: 'push'
      });

    const infoAwaitPromises = ctx.mokkas.map((mokka: any) =>
      new Promise((res) => {
        const timeoutId = setInterval(() => {
          mokka.send({type: 'info'});
        }, 1000);
        mokka.on('message', (msg: any) => {

          if (msg.type !== 'info' || msg.args[0].index !== recordsCount + recordsCount2)
            return;

          clearInterval(timeoutId);
          res(msg.args[0]);
        });
      })
    );
    await Promise.all(infoAwaitPromises);

    const stateAwaitPromises = ctx.mokkas.map((mokka: any) =>
      new Promise((res) => {
        mokka.send({type: 'pendings'});

        mokka.on('message', (msg: any) => {
          if (msg.type !== 'pendings')
            return;
          res(msg.args[0]);
        });
      })
    );

    const states = await Promise.all(stateAwaitPromises);

    // @ts-ignore
    expect(_.chain(states).uniqBy(_.isEqual).size().value()).to.eq(1);
  });


  it(`should replicate the queued logs and append them (${nodesCount} nodes)`, async () => {

    for (const mokka of ctx.mokkas)
      mokka.send({type: 'connect'});

    for (let i = 0; i < 100; i++) {
      ctx.mokkas[0].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51', {
          nonce: Date.now() + i,
          value: (Date.now() + i).toString()
        }],
        type: 'push'
      });
    }

    const infoAwaitPromises = ctx.mokkas.map((mokka: any) =>
      new Promise((res) => {
        const timeoutId = setInterval(() => {
          mokka.send({type: 'info'});
        }, 1000);

        mokka.on('message', (msg: any) => {

          if (msg.type !== 'info' || msg.args[0].index !== 100)
            return;

          clearInterval(timeoutId);
          res(msg.args[0]);

        });
      })
    );

    const infos = await Promise.all(infoAwaitPromises);
    expect(_.chain(infos).map((infos: any) => infos.hash).uniq().size().value()).to.eq(1);
  });

}
