const debug = require('diagnostics')('raft'),
  Log = require('./raft/log'),
  Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  MsgRaft = require('./controllers/MsgRaft');


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

let tasks = _.chain(new Array(1000)).fill(0).map((item, index) => [100 - index]).value();

const init = async () => {

  const nodes = [];

  for (let index = 0; index < ports.length; index++) {

    const raft = new MsgRaft('tcp://127.0.0.1:' + ports[index], {
      election_min: 2000,
      election_max: 5000,
      heartbeat: 1000,
      Log: Log,
      privateKey: privKeys[index],
      peers: pubKeys
    });

    raft.on('heartbeat timeout', function () {
      debug('heart beat timeout, starting election');
    });

    raft.on('term change', function (to, from) {
      debug('were now running on term %s -- was %s', to, from);
    }).on('leader change', function (to, from) {
      debug('we have a new leader to: %s -- was %s', to, from);
    }).on('state change', function (to, from) {
      debug('we have a state to: %s -- was %s', to, from);
    });


    raft.on('leader', function () {
      console.log(`node ${index} selected as leader`)
    });

    /*  raft.on('candidate', function () {
        console.log('----------------------------------');
        console.log('I am starting as candidate');
        console.log('----------------------------------');
      });
    */

    /*    raft.on('error', function (err) {
          console.log(err);
        });*/


    nodes.push(raft);

    ports.forEach((nr) => {
      if (!nr || ports[index] === nr) return;

      raft.actions.node.join('tcp://127.0.0.1:' + nr);
    });
  }

  await Promise.delay(1000);

  await Promise.all([
    (async () => {
      let node = nodes[1];
      for (let i = 0; i < 40; i++) {
        try {
          let entry = await node.actions.tasks.propose(tasks[i]);
          await node.actions.tasks.reserve(entry.index);
          console.log(1, entry.index, i);
          await node.actions.tasks.execute(entry.index);
        } catch (e) {
          console.log('error on: ', i)

          console.log(e)
        }

      }
      console.log('accomplished! 1')

    })(),
/*    (async () => {
      let node = nodes[2];
      for (let i = 340; i < 660; i++) {
        try {
          let entry = await node.actions.tasks.propose(tasks[i]);
          await node.actions.tasks.reserve(entry.index);
          //await Promise.delay(_.random(100, 500));
          console.log(2, entry.index, i);
          await node.actions.tasks.execute(entry.index);
        } catch (e) {
          console.log(e)
        }
      }
      console.log('accomplished! 2')
    })(),*/

/*    (async () => {
      let node = nodes[3];
      for (let i = 67; i < 100; i++) {
        try {
          let entry = await node.actions.tasks.propose(tasks[i]);
          await node.actions.tasks.reserve(entry.index);
          await Promise.delay(_.random(100, 500));
          console.log(3, entry.index, i);
          await node.actions.tasks.execute(entry.index);
        } catch (e) {
          console.log(e)
        }
      }

      console.log('accomplished! 3')
    })()*/
  ]);

  await Promise.delay(20000);

  setInterval(async () => {
    console.log('---checking entities------', new Date());

    const index1 = await nodes[1].log.getLastInfo();
    const index2 = await nodes[2].log.getLastInfo();
    const index3 = await nodes[3].log.getLastInfo();

    console.log(index1, index2, index3);

    let entities1 = await nodes[1].log.getEntriesAfter();
    let entities2 = await nodes[2].log.getEntriesAfter();
    let entities3 = await nodes[3].log.getEntriesAfter();

    console.log(entities1.length, entities2.length, entities3.length);

    console.log('---test---');
  //  console.log(await nodes[1].log.getFreeTasks())
  //  console.log(await nodes[1].log.getMetaEntriesAfter())

  }, 10000);

  // console.log(await nodes[1].log.getMetaEntriesAfter(0))


};

module.exports = init();
