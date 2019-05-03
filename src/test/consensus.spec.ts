import Promise from 'bluebird';
import {expect} from 'chai';
import {fork} from 'child_process';
import * as _ from 'lodash';
import * as path from 'path';

describe('consensus tests', (ctx = {mokkas: []}) => {

  beforeEach(() => {

    const mokkas: any = [];

    ctx.keys = [
      // tslint:disable-next-line
      'f7954a52cb4e6cb8a83ed0d6150a3dd1e4ae2c150054660b14abbdc23e16262b7b85cee8bf60035d1bbccff5c47635733b9818ddc8f34927d00df09c1da80b15',
      // tslint:disable-next-line
      '5530a97b921df76755c34e2dddee729072c425b5de4a273df60418f869eb2c9d796d8cf388c2a4ed8cb9f4c6fe9cfc1b1cdbdcf5edf238961f8915b9979f89b1',
      // tslint:disable-next-line
      '459136f8dbf054aa9c7be317d98f8bfea97dfe2726e6c56caf548680c074b05df9177556775896385a3e525e53f77fed09f2a88def0d1ebb67f539b33cbd98b1',
      // tslint:disable-next-line
      '644ae3a446e8d48760155dbf53167664bc89831039ab8f86957a00e411055b943b44191e5d19513dc5df07aa776943a9ef985c1546bcdcee0d74de66b095272c'
    ];

    for (let index = 0; index < ctx.keys.length; index++) {
      const instance = fork(path.join(__dirname, 'workers/MokkaWorker.js'));
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

  it('should replicate the log and append once most nodes online', async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});

    await Promise.all([
      new Promise((res) => {
        ctx.mokkas[0].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[1].substring(64, 128));
          res();
        });
      }),
      new Promise((res) => {
        ctx.mokkas[1].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[0].substring(64, 128));
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

    ctx.mokkas[2].send({type: 'connect'});
    ctx.mokkas[3].send({type: 'connect'});

    await Promise.all([

      new Promise((res) => {
        let missed = 0;
        ctx.mokkas[2].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;

          expect(msg.args[0]).to.be.oneOf([ctx.keys[0].substring(64, 128), ctx.keys[1].substring(64, 128)]);

          missed++;
          if (missed === 2)
            res();
        });
      }),
      new Promise((res) => {
        let missed = 0;
        ctx.mokkas[3].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;

          expect(msg.args[0]).to.be.oneOf([ctx.keys[0].substring(64, 128), ctx.keys[1].substring(64, 128)]);

          missed++;
          if (missed === 2)
            res();
        });
      })
    ]);

    const infoAwaitPromises = ctx.mokkas.map((mokka: any) =>
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

    const infos = await Promise.all(infoAwaitPromises);

    expect(_.chain(infos).map((infos: any) => infos.hash).uniq().size().value()).to.eq(1);
    expect(_.chain(infos).map((infos: any) => infos.committedIndex).uniq().size().value()).to.eq(1);
    expect(_.chain(infos).map((infos: any) => infos.committedIndex).head().value()).to.eq(2);
  });

  it('should be able to reach the consensus with 51% of nodes', async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});

    await Promise.all([
      new Promise((res) => {
        ctx.mokkas[0].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[1].substring(64, 128));
          res();
        });
      }),
      new Promise((res) => {
        ctx.mokkas[1].on('message', (msg: any) => {
          if (msg.type !== 'gossip_update')
            return;
          expect(msg.args[0]).to.eq(ctx.keys[0].substring(64, 128));
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

    const pendingState: any = await new Promise((res) => {
      ctx.mokkas[0].send({type: 'pendings'});

      ctx.mokkas[0].on('message', (msg: any) => {
        if (msg.type !== 'pendings')
          return;
        res(msg.args[0]);
      });
    });

    const pendingState2: any = await new Promise((res) => {
      ctx.mokkas[1].send({type: 'pendings'});

      ctx.mokkas[1].on('message', (msg: any) => {
        if (msg.type !== 'pendings')
          return;
        res(msg.args[0]);
      });
    });

    expect(pendingState.length).to.eq(1);
    expect(pendingState2.length).to.eq(1);

    ctx.mokkas[1].kill();

    ctx.mokkas[2].send({type: 'connect'});
    ctx.mokkas[3].send({type: 'connect'});

    const infoAwaitPromises = [ctx.mokkas[0], ctx.mokkas[2], ctx.mokkas[3]].map((mokka: any) =>
      new Promise((res) => {
        const timeoutId = setInterval(() => {
          mokka.send({type: 'info'});
        }, 1000);
        mokka.on('message', (msg: any) => {

          if (msg.type !== 'info' || msg.args[0].index !== 2 || msg.args[0].committedIndex !== 2)
            return;

          clearInterval(timeoutId);
          res(msg.args[0]);
        });
      })
    );

    const infos = await Promise.all(infoAwaitPromises);

    expect(_.chain(infos).map((infos: any) => infos.hash).uniq().size().value()).to.eq(1);
    expect(_.chain(infos).map((infos: any) => infos.committedIndex).uniq().size().value()).to.eq(1);
    expect(_.chain(infos).map((infos: any) => infos.committedIndex).head().value()).to.eq(2);

  });

  it('validate the state machine', async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});
    ctx.mokkas[2].send({type: 'connect'});
    ctx.mokkas[3].send({type: 'connect'});

    const recordsCount = _.random(100, 500);

    for (let i = 0; i < recordsCount; i++)
      ctx.mokkas[0].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B', {
          nonce: Date.now() + i,
          value: Date.now().toString()
        }],
        type: 'push'
      });

    const recordsCount2 = _.random(100, 500);

    for (let i = 0; i < recordsCount2; i++)
      ctx.mokkas[1].send({
        args: ['0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51', {
          nonce: Date.now() + i + 1,
          value: (Date.now() + i + 1).toString()
        }],
        type: 'push'
      });

    const infoAwaitPromises = [ctx.mokkas[0], ctx.mokkas[2], ctx.mokkas[3]].map((mokka: any) =>
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

    const stateAwaitPromises = [ctx.mokkas[0], ctx.mokkas[2], ctx.mokkas[3]].map((mokka: any) =>
      new Promise((res) => {
        ctx.mokkas[0].send({type: 'pendings'});

        ctx.mokkas[0].on('message', (msg: any) => {
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

  it('should replicate the queued logs and append them', async () => {

    ctx.mokkas[0].send({type: 'connect'});
    ctx.mokkas[1].send({type: 'connect'});
    ctx.mokkas[2].send({type: 'connect'});
    ctx.mokkas[3].send({type: 'connect'});

    for (let i = 0; i < 1000; i++) {
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

          if (msg.type !== 'info' || msg.args[0].committedIndex !== 1000)
            return;

          clearInterval(timeoutId);
          res(msg.args[0]);

        });
      })
    );

    const infos = await Promise.all(infoAwaitPromises);

    expect(_.chain(infos).map((infos: any) => infos.hash).uniq().size().value()).to.eq(1);
  });

  afterEach(async () => {
    for (const node of ctx.mokkas)
      node.kill();

    await Promise.delay(1000);
  });

});
