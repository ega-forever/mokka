const Log = require('./mokka/log/log'),
  Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  path = require('path'),
  hashUtils = require('./mokka/utils/hashes'),
  TCPMokka = require('./mokka/implementation/TCP');


process.on('unhandledRejection', function (reason, p) {
  console.log('Possibly Unhandled Rejection at: Promise ', p, ' reason: ', reason);
  // application specific logging here
});

const ports = [
  8081, 8082,
  8083, 8084,
  8085, 8086
];

let privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

//let tasks = _.chain(new Array(100000)).fill(0).map((item, index) => [100 - index]).value();
let tasks = _.chain(new Array(300)).fill(0).map((item, index) => [100 - index]).value();

let chunks = [Math.round(tasks.length * 0.3), Math.round(tasks.length * 0.6), tasks.length];

const init = async () => {

  const nodes = [];

  for (let index = 0; index < ports.length; index++) {

    const mokka = new TCPMokka({
      address: `/ip4/127.0.0.1/tcp/${ports[index]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
      election_min: 200,
      election_max: 300,
      heartbeat: 100,
      Log: Log,
      /*      log_options: {
        adapter: require('leveldown'),
        path: path.join('./', 'dump', `test.${index}.db`)
      },*/
      privateKey: privKeys[index],
      peers: pubKeys
    });

    mokka.index = index + 1;

    await Promise.delay(_.random(0, 100));

    mokka.on('heartbeat timeout', function () {
      console.log(`heart beat timeout, starting election[${this.index}]`);
    });


    mokka.on('error', function (err) {
      console.log('err taken: ', err);
    });


    nodes.push(mokka);

    for (let i = 0; i < ports.length; i++) {
      if (ports[index] === ports[i])
        continue;

      //mokka.actions.node.join('tcp://127.0.0.1:' + nr);
      mokka.actions.node.join(`/ip4/127.0.0.1/tcp/${ports[i]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[i])}`);

    }
  }

  await Promise.delay(1000);

  let start = Date.now();

  await Promise.all([
    (async () => {
      let node = nodes[0];
      for (let i = 0; i < chunks[0]; i++) 
        try {
          let entry = await Promise.resolve(node.processor.push(tasks[i]));
          console.log(1, entry.index, entry.hash, i);
        } catch (e) {

          if (e instanceof Promise.TimeoutError) {
            console.log('task has been reverted by timeout:', i);

            const index1 = await nodes[1].log.getLastInfo();
            const index2 = await nodes[2].log.getLastInfo();
            const index3 = await nodes[3].log.getLastInfo();

            console.log(index1, index2, index3);

            await Promise.delay(3000);
            continue;
          }

          console.log('err', e);
        }

      
      console.log('accomplished! 1');

    })(),
    (async () => {
      let node = nodes[1];
      for (let i = chunks[0] + 1; i < chunks[1]; i++) 
        try {
          let entry = await Promise.resolve(node.processor.push(tasks[i]));
          console.log(2, entry.index, entry.hash, i);
        } catch (e) {

          if (e instanceof Promise.TimeoutError) {
            console.log('task has been reverted by timeout:', i);

            const index1 = await nodes[1].log.getLastInfo();
            const index2 = await nodes[2].log.getLastInfo();
            const index3 = await nodes[3].log.getLastInfo();

            console.log(index1, index2, index3);

            await Promise.delay(3000);

            continue;
          }

          console.log(e);
        }
      
      console.log('accomplished! 2');
    })(),
    (async () => {
      let node = nodes[2];
      for (let i = chunks[1] + 1; i < chunks[2]; i++) 
        try {
          let entry = await Promise.resolve(node.processor.push(tasks[i]));
          console.log(3, entry.index, entry.hash, i);
        } catch (e) {

          if (e instanceof Promise.TimeoutError) {
            console.log('task has been reverted by timeout:', i);

            const index1 = await nodes[1].log.getLastInfo();
            const index2 = await nodes[2].log.getLastInfo();
            const index3 = await nodes[3].log.getLastInfo();

            console.log(index1, index2, index3);

            await Promise.delay(3000);

            continue;
          }

          console.log(e);
        }
      

      console.log('accomplished! 3');
    })()
  ]);

  let time = (Date.now() - start) / 1000;
  console.log('benchmark: ', time);
  console.log('process tx per second', tasks.length / time);
  await Promise.delay(2000);

  const index1 = await nodes[0].log.getLastInfo();
  const index2 = await nodes[1].log.getLastInfo();
  const index3 = await nodes[2].log.getLastInfo();
  const index4 = await nodes[3].log.getLastInfo();
  const index5 = await nodes[4].log.getLastInfo();
  const index6 = await nodes[5].log.getLastInfo();

  console.log(index1);
  console.log(index2);
  console.log(index3);
  console.log(index4);
  console.log(index5);
  console.log(index6);

  let entities1 = await nodes[0].log.getEntriesAfter();
  let entities2 = await nodes[1].log.getEntriesAfter();
  let entities3 = await nodes[2].log.getEntriesAfter();
  let entities4 = await nodes[3].log.getEntriesAfter();
  let entities5 = await nodes[4].log.getEntriesAfter();
  let entities6 = await nodes[5].log.getEntriesAfter();

  console.log(entities1.length, entities2.length, entities3.length, entities4.length, entities5.length, entities6.length);

  process.exit(0);


};

module.exports = init();
