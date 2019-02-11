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


  it('check role change and heartbeat', async () => {

    const {nodes} = await startPeers(ctx.ports);
    let states = [];

    const killCb = () => {
      console.log('killed by child!');
      process.exit(1);
    };


    for (let index = 0; index < nodes.length; index++) {
      nodes[index].on('message', (data) => {
        if (data.command === 'state')
          states.push({index: index, state: data.state});
      });
      nodes[index].on('exit', killCb);
    }


    await Promise.delay(1000 * (nodes.length + 1) + 2000);

    let leaderIndex = _.findIndex(states, item => item.state === 1);
    let itemsAfter = _.chain(states).takeRight(states.length - (leaderIndex + 1)).filter(item => [0, 1, 2, 4].includes(item.state)).size().value();

    for (let node of nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

    expect(itemsAfter).to.be.lt(nodes.length * 2);
  });

  it('check role change and heartbeat (node boot delay)', async () => {

    const {nodes} = await startPeers(ctx.ports);
    let states = [];

    const killCb = () => {
      console.log('killed by child!');
      process.exit(0);
    };

    for (let index = 0; index < nodes.length; index++) {
      nodes[index].on('message', (data) => {
        if (data.command === 'state')
          states.push({index: index, state: data.state});
      });
      nodes[index].on('exit', killCb);
    }

    await Promise.delay(1000 * (nodes.length + 1) + 10000);

    let leaderIndex = _.findIndex(states, item => item.state === 1);
    let itemsAfter = _.chain(states).takeRight(states.length - (leaderIndex + 1)).filter(item => [0, 1, 2, 4].includes(item.state)).size().value();

    for (let node of nodes) {
      node.removeListener('exit', killCb);
      node.kill();
    }

    expect(itemsAfter).to.be.lt(nodes.length);

  });

  it('run tasks concurrently (50 tasks per each node, kill one node during sync and restart)', async () => {

    const {nodes, privKeys} = await startPeers(ctx.ports);
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

    for (let index = 0; index < nodes.length; index++)
      for (let taskIndex = 0; taskIndex < taskAmount; taskIndex++)
        nodes[index].send({command: 'push', data: [`${Date.now()}.${ctx.ports[index]}`, `${_.random(0, 120000)}`, 'put']});


    await Promise.delay(10000);

    console.log('killing node...');
    nodes[0].removeListener('exit', killCb);
    nodes[0].kill();

    let {nodes: newNodes} = await startPeers(ctx.ports, privKeys, [0]);
    nodes[0] = newNodes[0];

    nodes[0].on('message', (data) => {
      if (data.command === 'status')
        states[0] = data.info;
    });
    nodes[0].on('exit', killCb);


    await Promise.delay(5000);

    let updateIntervalPid = setInterval(() => {
      for (let node of nodes)
        node.send({command: 'status'});
    }, 1000);

    await new Promise(res => {

      let intervalId = setInterval(async () => {
        let records = Object.values(states);

        if (records.length === nodes.length && _.uniq(records.map(rec => rec.hash)).length === 1) {


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
