/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const Log = require('../../mokka/log/log'),
  Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  hashUtils = require('../../mokka/utils/hashes'),
  TCPMokka = require('../../mokka/implementation/TCP');

module.exports = (ctx) => {

  before(async () => {

  });


  it('run 100 tasks serially (10 times)', async () => {


    for (let tries = 1; tries <= 10; tries++) {

      console.log(`run simulation ${tries}`);

      const ports = [
        8081, 8082,
        8083, 8084,
        8085, 8086
      ];

      let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
      let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

      let tasks = _.chain(new Array(100)).fill(0).map((item, index) => [100 - index]).value();

      let chunks = [Math.round(tasks.length * 0.3), Math.round(tasks.length * 0.6), tasks.length];

      const nodes = [];

      for (let index = 0; index < ports.length; index++) {

        const raft = new TCPMokka({
          address: `/ip4/127.0.0.1/tcp/${ports[index]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
          election_min: 2000,
          election_max: 3000,
          heartbeat: 1000,
          Log: Log,
          privateKey: privKeys[index],
          peers: pubKeys
        });

        raft.index = index + 1;

        raft.on('heartbeat timeout', function () {
          console.log(`heart beat timeout, starting election[${this.index}]`);
        });

        raft.on('error', function (err) {
          console.log(err);
        });


        nodes.push(raft);

        for (let i = 0; i < ports.length; i++) {
          if (ports[index] === ports[i])
            continue;

          raft.actions.node.join(`/ip4/127.0.0.1/tcp/${ports[i]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[i])}`);
        }
      }


      await Promise.delay(1000);

      await Promise.mapSeries(_.take(nodes, 3), async (node, index) => {
        for (let i = index === 0 ? 0 : chunks[index - 1]; i < chunks[index === 0 ? 0 : index]; i++) {
          try {
            let entry = await Promise.resolve(node.api.propose(tasks[i])).timeout(node.election.max);
            console.log(1, entry.index, entry.hash, i);
          } catch (e) {

            if (e instanceof Promise.TimeoutError) {
              console.log('task has been reverted by timeout:', i);

              const index1 = await nodes[0].log.getLastInfo();
              const index2 = await nodes[1].log.getLastInfo();
              const index3 = await nodes[2].log.getLastInfo();

              console.log(index1, index2, index3);

              await Promise.delay(5000);
              continue;
            }

            console.log(e)
          }

        }
        console.log('accomplished! 1');

      });


      await new Promise(res => {

        let intervalId = setInterval(async () => {

          const info1 = await nodes[0].log.getLastInfo();
          const info2 = await nodes[1].log.getLastInfo();
          const info3 = await nodes[2].log.getLastInfo();
          const info4 = await nodes[3].log.getLastInfo();
          const info5 = await nodes[4].log.getLastInfo();
          const info6 = await nodes[5].log.getLastInfo();

          if (_.uniq([info1.index, info2.index, info3.index, info4.index, info5.index, info6.index, tasks.length]).length === 1) {
            clearInterval(intervalId);
            res();
          }
        }, 3000);

      });


      for (let node of nodes) {
        node.actions.node.end();
        node.socket.close();

      }

      // process.exit(0)
    }
  });


  it('run 100 tasks concurrently (10 times)', async () => {


    for (let tries = 1; tries <= 10; tries++) {

      console.log(`run simulation ${tries}`);

      const ports = [
        8081, 8082,
        8083, 8084,
        8085, 8086
      ];

      let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
      let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

      let tasks = _.chain(new Array(1000)).fill(0).map((item, index) => [100 - index]).value();

      let chunks = [Math.round(tasks.length * 0.3), Math.round(tasks.length * 0.6), tasks.length];

      const nodes = [];

      for (let index = 0; index < ports.length; index++) {

        const raft = new TCPMokka({
          address: `/ip4/127.0.0.1/tcp/${ports[index]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
          election_min: 2000,
          election_max: 3000,
          heartbeat: 1000,
          Log: Log,
          privateKey: privKeys[index],
          peers: pubKeys
        });

        raft.index = index + 1;

        raft.on('heartbeat timeout', function () {
          console.log(`heart beat timeout, starting election[${this.index}]`);
        });

        raft.on('error', function (err) {
          console.log(err);
        });


        nodes.push(raft);

        for (let i = 0; i < ports.length; i++) {
          if (ports[index] === ports[i])
            continue;

          raft.actions.node.join(`/ip4/127.0.0.1/tcp/${ports[i]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[i])}`);
        }
      }


      await Promise.delay(1000);

      await Promise.all(_.take(nodes, 3).map(async (node, index) => {
        for (let i = index === 0 ? 0 : chunks[index - 1]; i < chunks[index === 0 ? 0 : index]; i++) {
          let entry = await Promise.resolve(node.api.propose(tasks[i]));
          console.log(1, entry.index, entry.hash, i);
        }
        console.log('accomplished! 1');

      })).catch(e => {
        console.log(e);
        process.exit(0)
      });


      await new Promise(res => {

        let intervalId = setInterval(async () => {

          const info1 = await nodes[0].log.getLastInfo();
          const info2 = await nodes[1].log.getLastInfo();
          const info3 = await nodes[2].log.getLastInfo();
          const info4 = await nodes[3].log.getLastInfo();
          const info5 = await nodes[4].log.getLastInfo();
          const info6 = await nodes[5].log.getLastInfo();

          if (_.uniq([info1.index, info2.index, info3.index, info4.index, info5.index, info6.index, tasks.length]).length === 1) {
            clearInterval(intervalId);
            res();
          }
        }, 3000);

      }).timeout(3000 * 3);


      for (let node of nodes) {
        node.actions.node.end();
        node.socket.close();
      }

      // process.exit(0)
    }
  });


  it('run 10000 tasks serially', async () => {

    const ports = [
      8081, 8082,
      8083, 8084,
      8085, 8086
    ];

    let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    let tasks = _.chain(new Array(10000)).fill(0).map((item, index) => [100 - index]).value();

    let chunks = [Math.round(tasks.length * 0.3), Math.round(tasks.length * 0.6), tasks.length];

    const nodes = [];

    for (let index = 0; index < ports.length; index++) {

      const raft = new TCPMokka({
        address: `/ip4/127.0.0.1/tcp/${ports[index]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
        election_min: 2000,
        election_max: 3000,
        heartbeat: 1000,
        Log: Log,
        privateKey: privKeys[index],
        peers: pubKeys
      });

      raft.index = index + 1;

      raft.on('heartbeat timeout', function () {
        console.log(`heart beat timeout, starting election[${this.index}]`);
      });

      raft.on('error', function (err) {
        console.log(err);
      });


      nodes.push(raft);

      for (let i = 0; i < ports.length; i++) {
        if (ports[index] === ports[i])
          continue;

        raft.actions.node.join(`/ip4/127.0.0.1/tcp/${ports[i]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[i])}`);
      }
    }


    await Promise.delay(1000);

    await Promise.mapSeries(_.take(nodes, 3), async (node, index) => {
      for (let i = index === 0 ? 0 : chunks[index - 1]; i < chunks[index === 0 ? 0 : index]; i++) {
        try {
          let entry = await Promise.resolve(node.api.propose(tasks[i])).timeout(node.election.max);
          console.log(1, entry.index, entry.hash, i);
        } catch (e) {

          if (e instanceof Promise.TimeoutError) {
            console.log('task has been reverted by timeout:', i);

            const index1 = await nodes[0].log.getLastInfo();
            const index2 = await nodes[1].log.getLastInfo();
            const index3 = await nodes[2].log.getLastInfo();

            console.log(index1, index2, index3);

            await Promise.delay(5000);
            continue;
          }

          console.log(e)
        }

      }
      console.log('accomplished! 1');

    });


    await new Promise(res => {

      let intervalId = setInterval(async () => {

        const info1 = await nodes[0].log.getLastInfo();
        const info2 = await nodes[1].log.getLastInfo();
        const info3 = await nodes[2].log.getLastInfo();
        const info4 = await nodes[3].log.getLastInfo();
        const info5 = await nodes[4].log.getLastInfo();
        const info6 = await nodes[5].log.getLastInfo();

        if (_.uniq([info1.index, info2.index, info3.index, info4.index, info5.index, info6.index, tasks.length]).length === 1) {
          clearInterval(intervalId);
          res();
        }
      }, 3000);

    });


    for (let node of nodes) {
      node.actions.node.end();
      node.socket.close();

    }

  });


  it('run 10000 tasks concurrently', async () => {

    const ports = [
      8081, 8082,
      8083, 8084,
      8085, 8086
    ];

    let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    let tasks = _.chain(new Array(10000)).fill(0).map((item, index) => [100 - index]).value();

    let chunks = [Math.round(tasks.length * 0.3), Math.round(tasks.length * 0.6), tasks.length];

    const nodes = [];

    for (let index = 0; index < ports.length; index++) {

      const raft = new TCPMokka({
        address: `/ip4/127.0.0.1/tcp/${ports[index]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
        election_min: 2000,
        election_max: 3000,
        heartbeat: 1000,
        Log: Log,
        privateKey: privKeys[index],
        peers: pubKeys
      });

      raft.index = index + 1;

      raft.on('heartbeat timeout', function () {
        console.log(`heart beat timeout, starting election[${this.index}]`);
      });

      raft.on('error', function (err) {
        console.log(err);
      });


      nodes.push(raft);

      for (let i = 0; i < ports.length; i++) {
        if (ports[index] === ports[i])
          continue;

        raft.actions.node.join(`/ip4/127.0.0.1/tcp/${ports[i]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[i])}`);
      }
    }


    await Promise.delay(1000);

    await Promise.all(_.take(nodes, 3).map(async (node, index) => {
      for (let i = index === 0 ? 0 : chunks[index - 1]; i < chunks[index === 0 ? 0 : index]; i++) {
        let entry = await Promise.resolve(node.api.propose(tasks[i]));
        console.log(1, entry.index, entry.hash, i);
      }
      console.log('accomplished! 1');

    })).catch(e => {
      console.log(e);
      process.exit(0)
    });


    await new Promise(res => {

      let intervalId = setInterval(async () => {

        const info1 = await nodes[0].log.getLastInfo();
        const info2 = await nodes[1].log.getLastInfo();
        const info3 = await nodes[2].log.getLastInfo();
        const info4 = await nodes[3].log.getLastInfo();
        const info5 = await nodes[4].log.getLastInfo();
        const info6 = await nodes[5].log.getLastInfo();

        if (_.uniq([info1.index, info2.index, info3.index, info4.index, info5.index, info6.index, tasks.length]).length === 1) {
          clearInterval(intervalId);
          res();
        }
      }, 3000);

    }).timeout(3000 * 3);


    for (let node of nodes) {
      node.actions.node.end();
      node.socket.close();
    }

    // process.exit(0)
  });


/*
  it('run 100 tasks concurrently (with delays)', async () => {

    const ports = [
      8081, 8082,
      8083, 8084,
      8085, 8086
    ];

    let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    let tasks = _.chain(new Array(100)).fill(0).map((item, index) => [100 - index]).value();

    let chunks = [Math.round(tasks.length * 0.3), Math.round(tasks.length * 0.6), tasks.length];

    const nodes = [];

    for (let index = 0; index < ports.length; index++) {

      const raft = new TCPMokka({
        address: `/ip4/127.0.0.1/tcp/${ports[index]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
        election_min: 2000,
        election_max: 3000,
        heartbeat: 1000,
        Log: Log,
        privateKey: privKeys[index],
        peers: pubKeys
      });

      raft.index = index + 1;

      raft.on('heartbeat timeout', function () {
        console.log(`heart beat timeout, starting election[${this.index}]`);
      });

      raft.on('error', function (err) {
        console.log(err);
      });


      nodes.push(raft);

      for (let i = 0; i < ports.length; i++) {
        if (ports[index] === ports[i])
          continue;

        raft.actions.node.join(`/ip4/127.0.0.1/tcp/${ports[i]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[i])}`);
      }
    }


    await Promise.delay(1000);

    await Promise.all(_.take(nodes, 3).map(async (node, index) => {
      for (let i = index === 0 ? 0 : chunks[index - 1]; i < chunks[index === 0 ? 0 : index]; i++) {
        let entry = await node.api.propose(tasks[i]);
        await Promise.delay(_.random(0, 4000));
        console.log(1, entry.index, entry.hash, i);
      }
      console.log('accomplished! 1');

    })).catch(e => {
      console.log(e);
      process.exit(0)
    });


    await new Promise(res => {

      let intervalId = setInterval(async () => {

        const info1 = await nodes[0].log.getLastInfo();
        const info2 = await nodes[1].log.getLastInfo();
        const info3 = await nodes[2].log.getLastInfo();
        const info4 = await nodes[3].log.getLastInfo();
        const info5 = await nodes[4].log.getLastInfo();
        const info6 = await nodes[5].log.getLastInfo();

        if (_.uniq([info1.index, info2.index, info3.index, info4.index, info5.index, info6.index, tasks.length]).length === 1) {
          clearInterval(intervalId);
          res();
        }
      }, 3000);

    }).timeout(3000 * 3);


    for (let node of nodes) {
      node.actions.node.end();
      node.socket.close();
    }

    // process.exit(0)
  });


  it(`another node can't take control once the master haven't committed the last record`, async () => {

    const ports = [
      8081, 8082,
      8083, 8084,
      8085, 8086
    ];

    let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
    let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

    let tasks = _.chain(new Array(1000)).fill(0).map((item, index) => [100 - index]).value();

    let chunks = [600, 1000];

    const nodes = [];

    for (let index = 0; index < ports.length; index++) {

      const raft = new TCPMokka({
        address: `/ip4/127.0.0.1/tcp/${ports[index]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
        election_min: 2000,
        election_max: 3000,
        heartbeat: 1000,
        Log: Log,
        privateKey: privKeys[index],
        peers: pubKeys
      });

      raft.index = index + 1;

      raft.on('heartbeat timeout', function () {
        console.log(`heart beat timeout, starting election[${this.index}]`);
        //if(raft.term > 1)
        //process.exit(0)
      });

      raft.on('error', function (err) {
        console.log(err);

        if (err instanceof Promise.TimeoutError) {
          process.exit(0);
        }

      });


      nodes.push(raft);

      for (let i = 0; i < ports.length; i++) {
        if (ports[index] === ports[i])
          continue;

        raft.actions.node.join(`/ip4/127.0.0.1/tcp/${ports[i]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[i])}`);
      }
    }


    await Promise.delay(1000);

    await Promise.all(_.take(nodes, 2).map(async (node, index) => {
      for (let i = index === 0 ? 0 : chunks[index - 1]; i < chunks[index === 0 ? 0 : index]; i++) {
        let entry = await node.api.propose(tasks[i]);
        console.log(1, entry.index, entry.hash, i);
      }
      console.log('accomplished! 1');

    })).catch(e => {
      console.log(e);
      process.exit(0)
    });


    await new Promise(res => {

      let intervalId = setInterval(async () => {

        const info1 = await nodes[0].log.getLastInfo();
        const info2 = await nodes[1].log.getLastInfo();
        const info3 = await nodes[2].log.getLastInfo();
        const info4 = await nodes[3].log.getLastInfo();
        const info5 = await nodes[4].log.getLastInfo();
        const info6 = await nodes[5].log.getLastInfo();

        if (_.uniq([info1.index, info2.index, info3.index, info4.index, info5.index, info6.index, tasks.length]).length === 1) {
          clearInterval(intervalId);
          res();
        }
      }, 3000);

    }).timeout(3000 * 3);


    for (let node of nodes) {
      node.actions.node.end();
      node.socket.close();
    }

    // process.exit(0)
  });
*/


  after('kill environment', async () => {
    // ctx.blockProcessorPid.kill();
    // await Promise.delay(30000);
  });


};
