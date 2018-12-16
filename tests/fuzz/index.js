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

  it('run tasks serially (100 tasks per each node)', async () => {

    ctx.nodes = [];
    let states = {};

    const nodePath = path.join(__dirname, '../node/node.js');

    let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    const killCb = () => {
      console.log('killed by child!');
      process.exit(0);
    };

    for (let index = 0; index < ctx.ports.length; index++) {

      let uris = [];

      for (let index1 = 0; index1 < ctx.ports.length; index1++) {
        if (index === index1)
          continue;
        uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
      }

      const nodePid = cp.fork(nodePath);

      ctx.nodes.push(nodePid);

      nodePid.send({
        command: 'start',
        options: {
          electionMax: 1000,
          electionMin: 300,
          delay: 100,
          heartbeat: 100,
          port: ctx.ports[index],
          peers: uris,
          privateKey: privKeys[index]
        }
      });


      // nodePid.stdout.on('data', (data) => {
      nodePid.on('message', (data) => {
        if (data.command === 'status') {
          states[index] = data.info;
        }
      });

      nodePid.on('exit', killCb);
    }


    await Promise.delay(2000);

    let taskAmount = 50;

    for (let index = 0; index < ctx.nodes.length; index++) {
      await Promise.delay(20000 * index);
      for (let taskIndex = index * taskAmount; taskIndex < index * taskAmount + taskAmount; taskIndex++)
        ctx.nodes[index].send({command: 'push', data: [taskIndex]});
    }


    await new Promise(res => {

      let intervalId = setInterval(async () => {
        let records = Object.values(states);


        console.log(records);


        if (records.length === ctx.nodes.length && _.uniq(records.map(rec => rec.hash)).length === 1 &&
          _.uniq(records.map(rec => rec.index)).length === 1 && _.uniq(records.map(rec => rec.index))[0] === taskAmount * ctx.nodes.length) {


          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);


          clearInterval(intervalId);
          res();
        }

        for (let node of ctx.nodes)
          node.send({command: 'status'});


      }, 5000);

    });

    /*
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

    */

    for (let node of ctx.nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

  });


  it('run tasks concurrently (50 tasks per each node)', async () => {

    ctx.nodes = [];
    let states = {};

    const nodePath = path.join(__dirname, '../node/node.js');

    let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    const killCb = () => {
      console.log('killed by child!');
      process.exit(0);
    };

    for (let index = 0; index < ctx.ports.length; index++) {

      let uris = [];

      for (let index1 = 0; index1 < ctx.ports.length; index1++) {
        if (index === index1)
          continue;
        uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
      }

      const nodePid = cp.fork(nodePath);

      ctx.nodes.push(nodePid);

      nodePid.send({
        command: 'start',
        options: {
          electionMax: 1000,
          electionMin: 300,
          delay: 100,
          heartbeat: 100,
          port: ctx.ports[index],
          peers: uris,
          privateKey: privKeys[index]
        }
      });


      // nodePid.stdout.on('data', (data) => {
      nodePid.on('message', (data) => {
        if (data.command === 'status') {
          states[index] = data.info;
        }
      });

      nodePid.on('exit', killCb);
    }


    await Promise.delay(2000);

    let taskAmount = 50;

    for (let index = 0; index < ctx.nodes.length; index++)
      for (let taskIndex = index * taskAmount; taskIndex < index * taskAmount + taskAmount; taskIndex++)
        ctx.nodes[index].send({command: 'push', data: [taskIndex]});


    await new Promise(res => {

      let intervalId = setInterval(async () => {
        let records = Object.values(states);

        if (records.length === ctx.nodes.length && _.uniq(records.map(rec => rec.hash)).length === 1 &&
          _.uniq(records.map(rec => rec.index)).length === 1 && _.uniq(records.map(rec => rec.index))[0] === taskAmount * ctx.nodes.length) {


          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);


          clearInterval(intervalId);
          res();
        }

        for (let node of ctx.nodes)
          node.send({command: 'status'});


      }, 5000);

    });

    /*
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

    */

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
