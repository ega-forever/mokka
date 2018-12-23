const Log = require('../mokka/log/log'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  path = require('path'),
  hashUtils = require('../mokka/utils/hashes'),
  detectPort = require('detect-port'),
  TCPMokka = require('../mokka/implementation/TCP'),
  states = require('../mokka/node/factories/stateFactory'),
  readline = require('readline');


let mokka = null;

process.on('unhandledRejection', function (reason, p) {
  console.log('Possibly Unhandled Rejection at: Promise ', p, ' reason: ', reason);
  // application specific logging here
  process.exit(0)
});


const startPort = 2000;
const keys = [
  'addfd4bad05a15fb2bbda77f93ecb8f89274ad81cfce48c53c89dac0bb4717b7',
  '36aa6e0db4e8450f8665f69009eb01e73ed49112da217019d810a398a78bc08b',
  'fe2054dd406fa09bf8fbf95fb8aa4abdf045ef32b8c8b7f702571bc8723885fb',
  'fe2054dd406fa09bf8fbf95fb8aa4abdf045ef32b8c8b7f702571bc8723885f1'
];


const hosts = [
  {host: '52.15.183.149', port: 12820},
  {host: '52.15.183.149', port: 19873},
  {host: '52.15.183.149', port: 13874},
  {host: '52.15.183.149', port: 19187}
];

const pubKeys = keys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

const initMokka = async () => {


  let index = -1;

  for (let start = 0; start < keys.length; start++) {

    if (index !== -1)
      continue;

    let detectedPort = await detectPort(startPort + start);

    if (detectedPort === startPort + start)
      index = start;
  }

  let uris = [];

  for (let index1 = 0; index1 < keys.length; index1++) {
    if (index === index1)
      continue;
        uris.push(`/ip4/127.0.0.1/tcp/${startPort + index1}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);

    //uris.push(`/ip4/${hosts[index1].host}/tcp/${hosts[index1].port}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
  }


  const peers = _.chain(pubKeys).cloneDeep().pullAt(index).value();

  mokka = new TCPMokka({
    address: `/ip4/127.0.0.1/tcp/${startPort + index}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
    electionMin: 200,
    electionMax: 1000,
    heartbeat: 100,
    Log: Log,
    log_options: {
      adapter: require('leveldown'),
      path: path.join('./', 'dump', `test.${index}.db`)
    },
    logLevel: 30,
    privateKey: keys[index],
    peers: peers
  });


  for (let peer of uris)
    mokka.actions.node.join(peer);

  mokka.on('error', function (err) {
    //console.log(err);
  });

  mokka.on('state change', function (state) {
    console.log(`state changed: ${_.invert(states)[state]}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });


  askCommand(rl, mokka);

};


const askCommand = (rl, mokka) => {
  rl.question('enter command > ', async (command) => {

    if (command.indexOf('generate ') === 0) {
      let amount = parseInt(command.replace('generate', '').trim());
      await generateTxs(mokka, amount)
    }

    if(command.indexOf('generate_as_single') === 0){
      let amount = parseInt(command.replace('generate_as_single', '').trim());
      await generateTxsAsSingle(mokka, amount);
    }


    askCommand(rl, mokka);
  });

};

const generateTxs = async (mokka, amount) => {

  for (let index = 0; index < amount; index++) {

    let tx = {
      to: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B',
      from: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51',
      nonce: index,
      timestamp: Date.now()
    };

    await mokka.processor.push(tx);
  }

};


const generateTxsAsSingle = async (mokka, amount) => {

  let txs = [];

  for (let index = 0; index < amount; index++) {

    let tx = {
      to: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B',
      from: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51',
      nonce: index,
      timestamp: Date.now()
    };

    txs.push(tx);

  }

  console.log('size', Buffer.from(JSON.stringify(txs)).length);
  await mokka.processor.push(txs);


};


module.exports = initMokka();
