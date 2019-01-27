/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const Promise = require('bluebird'),
  _ = require('lodash'),
  expect = require('chai').expect,
  startPeers = require('../utils/node/startPeers');

module.exports = (ctx) => {

  before(async () => {

    ctx.ports = [];

    let nodesCount = _.random(3, 7);

    for (let index = 0; index < nodesCount; index++)
      ctx.ports.push(2000 + index);
  });

  it('run tasks serially (50 tasks per each node)', async () => {

    const {nodes} = await startPeers(ctx.ports);
    let states = {};

    await Promise.delay(5000);

    const killCb = () => {
      console.log('killed by child!');
      process.exit(0);
    };


    for (let index = 0; index < nodes.length; index++) {
      nodes[index].on('message', (data) => {
        if (data.command === 'status')
          states[index] = data.info;
      });
      nodes[index].on('exit', killCb);
    }

    let taskAmount = 50;

    let updateIntervalPid = setInterval(() => {
      for (let node of nodes)
        node.send({command: 'status'});
    }, 1000);

    for (let index = 0; index < nodes.length; index++) {


      for (let taskIndex = 0; taskIndex < taskAmount; taskIndex++)
        nodes[index].send({command: 'push', data: [`${_.random(0, 120000)}.${Date.now()}`]});


      await new Promise(res => {
        let intervalPid = setInterval(() => {
          if (!states[index] || states[index].index !== (index + 1) * taskAmount) //todo await until most of nodes will ack
            return;

          clearInterval(intervalPid);
          res();
        }, 1000);

      })
    }


    await Promise.delay(10000);//todo remove

    clearInterval(updateIntervalPid);
    let records = Object.values(states);

    console.log(records)

    expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);


    for (let node of nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

  });

  it('run tasks concurrently (50 tasks per each node)', async () => {

    const {nodes} = await startPeers(ctx.ports);
    await Promise.delay(3000);
    let states = {};

    const killCb = () => {
      console.log('killed by child!');
      process.exit(0);
    };


    for (let index = 0; index < nodes.length; index++) {
      nodes[index].on('message', (data) => {
        if (data.command === 'status')
          states[index] = data.info;
      });
      nodes[index].on('exit', killCb);
    }

    let taskAmount = 50;

    let updateIntervalPid = setInterval(() => {
      for (let node of nodes)
        node.send({command: 'status'});
    }, 1000);

    for (let index = 0; index < nodes.length; index++)
      for (let taskIndex = 0; taskIndex < taskAmount; taskIndex++)
        nodes[index].send({command: 'push', data: [`${_.random(0, 120000)}.${Date.now()}.${ctx.ports[index]}`]});


    const pushed = [0];

    await new Promise(res => {

      let intervalId = setInterval(async () => {
        let records = Object.values(states);

        if (records.length === nodes.length && _.uniq(records.map(rec => rec.hash)).length === 1) {
          let nextIndex = records[0].index / taskAmount;

          if (!pushed.includes(nextIndex) && _.isInteger(nextIndex) && nextIndex <= nodes.length - 1) {
            for (let taskIndex = nextIndex * taskAmount; taskIndex < nextIndex * taskAmount + taskAmount; taskIndex++)
              nodes[nextIndex].send({command: 'push', data: [taskIndex]});

            pushed.push(nextIndex);
          }
        }


        if (records.length === nodes.length && _.uniq(records.map(rec => rec.hash)).length === 1 &&
          _.uniq(records.map(rec => rec.index)).length === 1 && _.uniq(records.map(rec => rec.index))[0] === taskAmount * nodes.length) {


          expect(_.uniq(records.map(rec => rec.hash)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.index)).length).to.eq(1);
          expect(_.uniq(records.map(rec => rec.term)).length).to.eq(1);


          clearInterval(intervalId);
          res();
        }

        for (let node of nodes)
          node.send({command: 'status'});


      }, 5000);

    });

    await Promise.delay(5000);

    clearInterval(updateIntervalPid);
    for (let node of nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }


  });

  after('kill environment', async () => {});


};
