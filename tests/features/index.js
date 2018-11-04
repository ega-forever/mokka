/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  expect = require('chai').expect,
  hashUtils = require('../../mokka/utils/hashes'),
  spawn = require('child_process').spawn,
  path = require('path');

module.exports = (ctx) => {

  before(async () => {

    /*    ctx.nodes = [];

        const nodePath = path.join(__dirname, '../node/node.js');

        const ports = [
          8081, 8082,
          8083, 8084,
          8085, 8086
        ];

        let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
        let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

        for (let index = 0; index < ports.length; index++) {

          let uris = [];

          for (let index1 = 0; index1 < ports.length; index1++) {
            if (index === index1)
              continue;
            uris.push(`/ip4/127.0.0.1/tcp/${ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
          }

          let amount = 100;

          const nodePid = spawn('node', [nodePath], {
            env: _.merge({}, process.env, {
              PRIVATE_KEY: privKeys[index],
              PORT: ports[index],
              PEERS: uris.join(';'),
              CHUNKS: [amount * index + 1, amount * (index + 1)].join(':')
            }),
            stdio: 'inherit'
          });

          ctx.nodes.push(nodePid)

        }*/

    //  await Promise.delay(120000);

  });


  it('run 1000 tasks serially (10 times)', async () => {


    for (let tries = 1; tries <= 10; tries++) {

      console.log(`run simulation ${tries}`);

      ctx.nodes = [];
      let states = {};

      const nodePath = path.join(__dirname, '../node/node.js');

      const ports = [
        8081, 8082,
        8083, 8084,
        8085, 8086
      ];

      let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
      let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

      const killCb = () => {
        console.log('killed by child!')
        process.exit(0);
      };

      for (let index = 0; index < ports.length; index++) {

        let uris = [];

        for (let index1 = 0; index1 < ports.length; index1++) {
          if (index === index1)
            continue;
          uris.push(`/ip4/127.0.0.1/tcp/${ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
        }

        let amount = 100;

        const nodePid = spawn('node', [nodePath], {
          env: _.merge({}, process.env, {
            PRIVATE_KEY: privKeys[index],
            PORT: ports[index],
            PEERS: uris.join(';'),
            CHUNKS: [amount * index + 1, amount * (index + 1)].join(':')
          })
          //  stdio: 'inherit'
        });

        ctx.nodes.push(nodePid);

        nodePid.stdout.on('data', (data) => {
          data = data.toString();
          console.log(data);
          try {
            data = JSON.parse(data);
            if (_.isNumber(data.node))
              states[index] = data;
          } catch (e) {
          }
        });

        nodePid.on('exit', killCb);

      }

      await new Promise(res => {

        let intervalId = setInterval(() => {
          let records = Object.values(states);
          if (records.length === 6) {

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


  after('kill environment', async () => {
    // ctx.blockProcessorPid.kill();
    // await Promise.delay(30000);
  });


};
