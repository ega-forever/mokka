const Log = require('../../mokka/log/log'),
  Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  hashUtils = require('../../mokka/utils/hashes'),
  TCPMokka = require('../../mokka/implementation/TCP');


process.on('unhandledRejection', function (reason, p) {
  console.log('Possibly Unhandled Rejection at: Promise ', p, ' reason: ', reason);
  // application specific logging here
});


const peers = _.chain(process.env.PEERS).split(';').map(uri => {
  return {
    uri: uri,
    pubKey: _.last(uri.split('/'))
  }
})
  .value();

const tasks = _.chain(process.env.CHUNKS).split(':').thru(items => {

  let arr = [];
  for (let index = parseInt(items[0]); index < items[1]; index++)
    arr.push(index);

  return arr;
})
  .value();

const randomDelay = process.env.RANDOM_DELAY ? parseInt(process.env.RANDOM_DELAY) : false;
const startDelay = process.env.START_DELAY ? parseInt(process.env.START_DELAY) : 0;

const privKey = process.env.PRIVATE_KEY;
const port = process.env.PORT;
const pubKey = Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex');

const init = async () => {

  if(startDelay)
    await Promise.delay(startDelay);

  const mokka = new TCPMokka({
    address: `/ip4/127.0.0.1/tcp/${port}/ipfs/${hashUtils.getIpfsHashFromHex(pubKey)}`,
    electionMin: process.env.ELECTION_MIN ? parseInt(process.env.ELECTION_MIN) : 200,
    electionMax: process.env.ELECTION_MAX ? parseInt(process.env.ELECTION_MAX) : 1000,
    heartbeat: process.env.HEARTBEAT ? parseInt(process.env.HEARTBEAT) : 100,
    Log: Log,
    privateKey: privKey,
    peers: peers.map(peer => peer.pubKey)
  });

  await Promise.delay(_.random(0, 100));

  mokka.on('heartbeat timeout', function () {
    console.log(`heart beat timeout, starting election[${process.env.NODE_INDEX || 0}]`);
  });

  mokka.on('error', function (err) {
    console.log(err);
  });


  for (let peer of peers)
    mokka.actions.node.join(peer.uri);


  await new Promise(res => process.on('message', res));


  for (let task of tasks) {

    if(randomDelay)
      await Promise.delay(_.random(this.electionMin, this.electionMax * 2));

    console.log('running task at index: ', tasks.indexOf(task));
    let entry = await mokka.processor.push(task);
    console.log(process.env.NODE_INDEX || 0, entry.index, entry.hash);
    //await Promise.delay(_.random(50, 100));
  }


  const ports = [
    8081, 8082,
    8083, 8084,
    8085, 8086
  ];

  setInterval(async ()=>{
    const info = await mokka.log.getLastInfo();

    console.log(JSON.stringify(_.merge({node: ports.indexOf(parseInt(port)) + 1}, info)));
    process.send(JSON.stringify(_.merge({node: ports.indexOf(parseInt(port)) + 1}, info)));


  }, 3000);

};

module.exports = init();
