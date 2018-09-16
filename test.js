const P2pController = require('./controllers/p2pController'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  crypto = require('crypto'),
  Promise = require('bluebird');


const init = async () => {

  const blocks = [
    [1, 99],
    [100, 200],
    [300, 301],
    [402, 503]
  ];

  const tasks = blocks.map(pair => ({
    id: crypto.createHash('md5').update(JSON.stringify(pair)).digest('hex'),
    data: pair,
    locked: false
  }));

  let privKeys = _.chain(new Array(3)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();
  let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

  const peer = new P2pController(privKeys[0], pubKeys);
  await peer.start();
  peer.setState(tasks); //set missed blocks chunks as micro tasks

  peer.on('synced', ()=>console.log('super1!'))

  await Promise.delay(5000);
  console.log('start service 2');

  const peer2 = new P2pController(privKeys[1], pubKeys);
  await peer2.start();

  peer.on('synced', ()=>console.log('super2!'))

  await Promise.delay(5000);
  console.log('start service 3');

  const peer3 = new P2pController(privKeys[2], pubKeys);
  await peer3.start();
  peer.on('synced', ()=>console.log('super3!'))


/*  await Promise.delay(2000);

  console.log('validate states...');
  console.log(_.isEqual(peer.tasks, peer2.tasks));
  console.log(_.isEqual(peer.tasks, peer3.tasks));*/


/*  console.log('propose task...');
  await peer.propose(tasks[0].id);

  peer.on('task_pulled', ()=>console.log('super!'))

  await Promise.delay(3000);
  console.log('validate states...');
  console.log(_.isEqual(peer.tasks, peer2.tasks));
  console.log(_.isEqual(peer.tasks, peer3.tasks));*/


};

module.exports = init().catch(e => console.log(e));
