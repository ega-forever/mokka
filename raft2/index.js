const debug = require('diagnostics')('raft'),
  Log = require('./raft/log'),
  Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  _= require('lodash'),
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

for (let index = 0; index < ports.length; index++) {

  const raft = new MsgRaft('tcp://127.0.0.1:' + ports[index], {
    'election min': 2000,
    'election max': 5000,
    'heartbeat': 1000,
    Log: Log
  });

  raft.privateKey = privKeys[index];
  raft.peers = pubKeys;

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

/*
  raft.on('leader', function () {
    console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@');
    console.log('I am elected as leader');
    console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@');
  });

  raft.on('candidate', function () {
    console.log('----------------------------------');
    console.log('I am starting as candidate');
    console.log('----------------------------------');
  });
*/


  if (index === 1)
    setTimeout(async () => {
      const taskData = [12, 20];
      let entry = await raft.proposeTask(taskData);
      await raft.reserveTask(entry.index);
      await Promise.delay(5000);
      console.log(index, entry.index);
      await raft.executeTask(entry.index);
    }, 5000);

  if (index === 2)
    setTimeout(async () => {
      const taskData = [21, 32];
      let entry = await raft.proposeTask(taskData);
      await raft.reserveTask(entry.index);
      await Promise.delay(5000);
      console.log(index, entry.index);
      await raft.executeTask(entry.index);
    }, 5000);


  if (index === 3)
    setTimeout(async () => {
      const taskData = [33, 199];
      let entry = await raft.proposeTask(taskData);
      await Promise.delay(5000);
      await raft.reserveTask(entry.index);
      await Promise.delay(5000);
      console.log(index, entry.index);
      await raft.executeTask(entry.index);
    }, 5000);
  /*  raft.on('vote', ()=>{
      console.log('i am voting!')
    });*/

//
// Join in other nodes so they start searching for each other.
//
  ports.forEach((nr) => {
    if (!nr || ports[index] === nr) return;

    raft.join('tcp://127.0.0.1:' + nr);
  });


}

