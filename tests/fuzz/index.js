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

    for (let taskIndex = 0; taskIndex < taskAmount; taskIndex++)
      ctx.nodes[0].send({command: 'push', data: [taskIndex]});


    const pushed = [0];

    await new Promise(res => {

      let intervalId = setInterval(async () => {
        let records = Object.values(states);

        if (records.length === ctx.nodes.length && _.uniq(records.map(rec => rec.hash)).length === 1) {

          let nextIndex = records[0].index / taskAmount;

          if (!pushed.includes(nextIndex) && _.isInteger(nextIndex) && nextIndex <= ctx.nodes.length - 1) {
            for (let taskIndex = nextIndex * taskAmount; taskIndex < nextIndex * taskAmount + taskAmount; taskIndex++)
              ctx.nodes[nextIndex].send({command: 'push', data: [taskIndex]});

            pushed.push(nextIndex);
          }

        }


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

    for (let node of ctx.nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

  });

*/

  it('run tasks concurrently (50 tasks per each node, kill one node during sync and restart)', async () => {

    ctx.nodes = [];
    let states = {};

    const nodePath = path.join(__dirname, '../node/node.js');

    let privKeys = _.chain(new Array(ctx.ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    console.log(require('util').inspect(pubKeys, null, 3));

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

//        console.log(`node at ${index} recieved port ${ctx.ports[index]} and key ${privKeys[index]}`);


      nodePid.on('message', (data) => {
        if (data.command === 'status') {
          states[data.pid] = data.info;
        }
      });

      nodePid.on('exit', killCb);
    }

    await Promise.delay(2000);

    let taskAmount = 50;

    for (let index = 0; index < ctx.nodes.length; index++)
      for (let taskIndex = index * taskAmount; taskIndex < index * taskAmount + taskAmount; taskIndex++)
        ctx.nodes[index].send({command: 'push', data: [taskIndex]});

    let randomNodeIndexToKill = _.random(0, ctx.nodes.length - 1);
    let isRestored = false;


    setTimeout(async () => {

      console.log('killing node', randomNodeIndexToKill)
      ctx.nodes[randomNodeIndexToKill].removeListener('exit', killCb);
      ctx.nodes[randomNodeIndexToKill].kill();
      //_.pullAt(ctx.nodes, randomNodeIndexToKill);
      states = {};

      await Promise.delay(10000);
      console.log('after delay');

      let uris = [];

      for (let index1 = 0; index1 < ctx.ports.length; index1++) {
        if (randomNodeIndexToKill === index1)
          continue;
        uris.push(`/ip4/127.0.0.1/tcp/${ctx.ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
      }

      const nodePid = cp.fork(nodePath);
      ctx.nodes[randomNodeIndexToKill] = nodePid;

      nodePid.send({
        command: 'start',
        options: {
          electionMax: 1000,
          electionMin: 300,
          delay: 100,
          heartbeat: 100,
          port: ctx.ports[randomNodeIndexToKill],
          peers: uris,
          privateKey: privKeys[randomNodeIndexToKill]
        }
      });


      nodePid.on('message', (data) => {
        if (data.command === 'status') {
          states[data.pid] = data.info;
        }
      });

      nodePid.on('exit', killCb);

      await Promise.delay(2000);
      isRestored = true;

    }, 15000);

    await new Promise(res => {

      let intervalId = setInterval(async () => {

        if (!isRestored)
          return;


        console.log(require('util').inspect(states, null, 10));

        let records = Object.values(states);

        if (records.length === ctx.nodes.length && _.uniq(records.map(rec => rec.hash)).length === 1 &&
          _.uniq(records.map(rec => rec.index)).length === 1 && isRestored) {

          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);

          clearInterval(intervalId);
          res();
          return;
        }

        for (let node of ctx.nodes)
          node.send({command: 'status'});

      }, 5000);
    });

    for (let node of ctx.nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

    await Promise.delay(5000);

  });


  after('kill environment', async () => {
    console.log('done')
  });


};
