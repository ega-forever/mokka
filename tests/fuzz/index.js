/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  path = require('path'),
  _ = require('lodash'),
  expect = require('chai').expect,
  cp = require('child_process'),
  hashUtils = require('../../mokka/utils/hashes');

module.exports = (ctx) => {

  before(async () => {

    ctx.ports = [];

    let nodesCount = _.random(3, 7);

    for (let index = 0; index < nodesCount; index++)
      ctx.ports.push(2000 + index);
  });



/*
  it('run tasks serially (3 times, 100 task per each node)', async () => {


    for (let tries = 1; tries <= 3; tries++) {

      //      await Promise.delay(10000);
      console.log(`run simulation ${tries}`);

      ctx.nodes = [];
      let states = {};

      const nodePath = path.join(__dirname, '../node/node.js');


      let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
      let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

      const killCb = () => {
        console.log('killed by child!')
        process.exit(0);
      };

      for (let index = 0; index < ctx.ports.length; index++) {

        let uris = [];

        for (let index1 = 0; index1 < ctx.ports.length; index1++) {
          if (index === index1)
            continue;
          uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
        }

        let amount = 100;

        const nodePid = cp.fork(nodePath, {
          env: _.merge({}, process.env, {
            PRIVATE_KEY: privKeys[index],
            PORT: ctx.ports[index],
            PEERS: uris.join(';'),
            CHUNKS: [amount * index + 1, amount * (index + 1)].join(':')
          })
        });

        ctx.nodes.push(nodePid);


        // nodePid.stdout.on('data', (data) => {
        nodePid.on('message', (data) => {
          data = data.toString();
          console.log(data);
          try {
            data = JSON.parse(data);
            if (_.isNumber(data.node)) {
              states[index] = data;
            }
          } catch (e) {
          }
        });

        nodePid.on('exit', killCb);

        let checkInterval = setInterval(async () => {

          let records = Object.values(states);

          console.log('checking', index, records.length)
          if (records.length !== index)
            return;

          console.log('starting...')
          nodePid.send({start: true});
          clearInterval(checkInterval);
        }, 10000);

      }

      await new Promise(res => {

        let intervalId = setInterval(() => {
          let records = Object.values(states);
          if (records.length === ctx.nodes.length) {

            console.log(records)

            expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
            expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
            expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);

            clearInterval(intervalId);
            res();
          }
        }, 3000);

      });

      for (let node of ctx.nodes) {
        node.removeListener('exit', killCb);
        node.kill();
      }

    }
  });

  it('run tasks concurrently (3 times, 100 tasks per each node)', async () => {


    for (let tries = 1; tries <= 3; tries++) {

      console.log(`run simulation ${tries}`);

      ctx.nodes = [];
      let states = {};

      const nodePath = path.join(__dirname, '../node/node.js');

      let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
      let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

      const killCb = () => {
        console.log('killed by child!')
        process.exit(0);
      };

      for (let index = 0; index < ctx.ports.length; index++) {

        let uris = [];

        for (let index1 = 0; index1 < ctx.ports.length; index1++) {
          if (index === index1)
            continue;
          uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
        }

        let amount = 100;

        const nodePid = cp.fork(nodePath, {
          env: _.merge({}, process.env, {
            PRIVATE_KEY: privKeys[index],
            PORT: ctx.ports[index],
            PEERS: uris.join(';'),
            CHUNKS: [amount * index + 1, amount * (index + 1)].join(':')
          })
        });

        ctx.nodes.push(nodePid);


        // nodePid.stdout.on('data', (data) => {
        nodePid.on('message', (data) => {
          data = data.toString();
          console.log(data);
          try {
            data = JSON.parse(data);
            if (_.isNumber(data.node)) {
              states[index] = data;
            }
          } catch (e) {
          }
        });

        nodePid.on('exit', killCb);
      }


      await Promise.delay(10000);

      for (let node of ctx.nodes)
        node.send({start: true});

      await new Promise(res => {

        let intervalId = setInterval(() => {
          let records = Object.values(states);
          if (records.length === ctx.nodes.length) {

            expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
            expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
            expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);

            clearInterval(intervalId);
            res();
          }
        }, 3000);

      });

      for (let node of ctx.nodes) {
        node.removeListener('exit', killCb);
        node.kill();
      }
    }
  });

  it('run tasks concurrently (1 time, 1000 tasks per each node)', async () => {

    ctx.nodes = [];
    let states = {};

    const nodePath = path.join(__dirname, '../node/node.js');

    let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    const killCb = () => {
      console.log('killed by child!')
      process.exit(0);
    };

    for (let index = 0; index < ctx.ports.length; index++) {

      let uris = [];

      for (let index1 = 0; index1 < ctx.ports.length; index1++) {
        if (index === index1)
          continue;
        uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
      }

      let amount = 1000;

      const nodePid = cp.fork(nodePath, {
        env: _.merge({}, process.env, {
          PRIVATE_KEY: privKeys[index],
          PORT: ctx.ports[index],
          PEERS: uris.join(';'),
          CHUNKS: [amount * index + 1, amount * (index + 1)].join(':')
        })
      });

      ctx.nodes.push(nodePid);


      // nodePid.stdout.on('data', (data) => {
      nodePid.on('message', (data) => {
        data = data.toString();
        console.log(data);
        try {
          data = JSON.parse(data);
          if (_.isNumber(data.node)) {
            states[index] = data;
          }
        } catch (e) {
        }
      });

      nodePid.on('exit', killCb);
    }


    await Promise.delay(10000);

    for (let node of ctx.nodes)
      node.send({start: true});

    await new Promise(res => {

      let intervalId = setInterval(() => {
        let records = Object.values(states);
        if (records.length === ctx.nodes.length) {

          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);

          clearInterval(intervalId);
          res();
        }
      }, 3000);

    });

    for (let node of ctx.nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

  });

  it('run tasks concurrently (1 time, 100 tasks per each node, one of the nodes up with the delay)', async () => {

    ctx.nodes = [];
    let states = {};

    const nodePath = path.join(__dirname, '../node/node.js');

    let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    const killCb = () => {
      console.log('killed by child!')
      process.exit(0);
    };

    for (let index = 0; index < ctx.ports.length; index++) {

      let uris = [];

      for (let index1 = 0; index1 < ctx.ports.length; index1++) {
        if (index === index1)
          continue;
        uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
      }

      let amount = 100;

      const nodePid = cp.fork(nodePath, {
        env: _.merge({}, process.env, {
          PRIVATE_KEY: privKeys[index],
          PORT: ctx.ports[index],
          PEERS: uris.join(';'),
          CHUNKS: [amount * index + 1, amount * (index + 1)].join(':'),
          START_DELAY: index === 0 ? 20000 : 0
        })
      });

      ctx.nodes.push(nodePid);


      // nodePid.stdout.on('data', (data) => {
      nodePid.on('message', (data) => {
        data = data.toString();
        console.log(data);
        try {
          data = JSON.parse(data);
          if (_.isNumber(data.node)) {
            states[index] = data;
          }
        } catch (e) {
        }
      });

      nodePid.on('exit', killCb);
    }


    await Promise.delay(10000);

    for (let index = 1; index < ctx.nodes.length; index++)
      ctx.nodes[index].send({start: true});


    setTimeout(() => {
      ctx.nodes[0].send({start: true});
    }, 25000);

    await new Promise(res => {

      let intervalId = setInterval(() => {
        let records = Object.values(states);
        if (records.length === ctx.nodes.length) {

          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);

          clearInterval(intervalId);
          res();
        }
      }, 3000);

    });

    for (let node of ctx.nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

  });
*/

  it('run tasks concurrently (1 time, 100 tasks per each node, kill one node during sync and restart)', async () => {

    ctx.nodes = [];
    let states = {};

    const nodePath = path.join(__dirname, '../node/node.js');

    let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    const killCb = () => {
      console.log('killed by child!')
      process.exit(0);
    };

    for (let index = 0; index < ctx.ports.length; index++) {

      let uris = [];

      for (let index1 = 0; index1 < ctx.ports.length; index1++) {
        if (index === index1)
          continue;
        uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
      }

      let amount = 100;

      const nodePid = cp.fork(nodePath, {
        env: _.merge({}, process.env, {
          PRIVATE_KEY: privKeys[index],
          PORT: ctx.ports[index],
          PEERS: uris.join(';'),
          CHUNKS: [amount * index + 1, amount * (index + 1)].join(':'),
          START_DELAY: index === 0 ? 20000 : 0
        })
      });

      ctx.nodes.push(nodePid);


      // nodePid.stdout.on('data', (data) => {
      nodePid.on('message', (data) => {
        data = data.toString();
        console.log(data);
        try {
          data = JSON.parse(data);
          if (_.isNumber(data.node)) {
            states[index] = data;
          }
        } catch (e) {
        }
      });

      nodePid.on('exit', killCb);
    }


    await Promise.delay(10000);

    for (let index = 1; index < ctx.nodes.length; index++)
      ctx.nodes[index].send({start: true});


    setTimeout(() => {
      ctx.nodes[0].send({start: true});
    }, 25000);

    await new Promise(res => {

      let intervalId = setInterval(() => {
        let records = Object.values(states);
        if (records.length === ctx.nodes.length) {

          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);

          clearInterval(intervalId);
          res();
        }
      }, 3000);

    });


    let killNode = ctx.nodes[1];
    killNode.removeListener('exit', killCb);
    killNode.kill();

    let uris = [];

    for (let index1 = 0; index1 < ctx.ports.length; index1++) {
      if (index1 === 1)
        continue;
      uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
    }

    states = {};

    ctx.nodes[1] = cp.fork(nodePath, {
      env: _.merge({}, process.env, {
        PRIVATE_KEY: privKeys[1],
        PORT: ctx.ports[1],
        PEERS: uris.join(';'),
        CHUNKS: [100 * 8, 100 * 9].join(':'),
        START_DELAY: 20000
      })
    });


    ctx.nodes[1].on('message', (data) => {
      data = data.toString();
      console.log(data);
      try {
        data = JSON.parse(data);
        if (_.isNumber(data.node)) {
          states[index] = data;
        }
      } catch (e) {
      }
    });


    setTimeout(() => {
      ctx.nodes[1].send({start: true});
    }, 25000);


    await new Promise(res => {

      let intervalId = setInterval(() => {
        let records = Object.values(states);
        if (records.length === ctx.nodes.length) {

          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);

          clearInterval(intervalId);
          res();
        }
      }, 3000);

    });



    for (let node of ctx.nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

  });


  after('kill environment', async () => {
    // ctx.blockProcessorPid.kill();
    // await Promise.delay(30000);
  });


};
