const Log = require('../../../mokka/log/log'),
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  hashUtils = require('../../../mokka/utils/hashes'),
  TCPMokka = require('../../../mokka/implementation/TCP');

let mokka = null;

process.on('unhandledRejection', function (reason, p) {
  console.log('Possibly Unhandled Rejection at: Promise ', p, ' reason: ', reason);
  // application specific logging here
  process.exit(0)
});


process.on('message', message => {

  if (message.command === 'start')
    initMokka(message.options);

  if (message.command === 'push')
    sendCommand(...message.data);

  if (message.command === 'status')
    getStatus();

  if (message.command === 'logs')
    getLogs();

});


const initMokka = (options) => {

  const pubKey = Wallet.fromPrivateKey(Buffer.from(options.privateKey, 'hex')).getPublicKey().toString('hex');

  const pubKeys = options.peers.map(uri => hashUtils.getHexFromIpfsHash(_.last(uri.split('/'))));

  mokka = new TCPMokka({
    address: `/ip4/127.0.0.1/tcp/${options.port}/ipfs/${hashUtils.getIpfsHashFromHex(pubKey)}`,
    electionMin: options.electionMin || 200,
    electionMax: options.electionMax || 1000,
    heartbeat: options.heartbeat || 100,
    Log: Log,
    logLevel: options.logLevel || 10,
    privateKey: options.privateKey,
    peers: pubKeys,
    removeSynced: false,
    applier: async (command, state) => {

      if (command.type === 'put') {
        let value = await state.get(command.key);
        value = (value || 0) + command.value;
        await state.put(command.key, value);

      }

    },
    unapplier: async (command, state) => {

      if (command.type === 'put') {
        let value = await state.get(command.key);
        value = (value || 0) - command.value;
        await state.put(command.key, value);

      }


    }
  });


  for (let peer of options.peers)
    mokka.actions.node.join(peer);


  mokka.on('error', function (err) {
   // console.log(err);
  });


  mokka.on('state change', function (state) {
    console.log(`state changed: ${state}`);
    getState();
  });


};

const sendCommand = async (...command) => {
  mokka.processor.push(...command);
  process.send({command: 'pushed', data: command});
};

const getStatus = async () => {
  const info = await mokka.log.entry.getLastInfo();
  process.send({command: 'status', info: info, pid: process.pid})
};

const getState = () => {
  process.send({command: 'state', state: mokka.state, pid: process.pid})
};

const getLogs = async () => {
  const info = await mokka.log.entry.getLastInfo();

  let items = [];

  for (let index = 0; index <= info.index; index++) {
    let log = await mokka.log.get(index);
    if (log)
      items.push(log);
  }

  process.send({command: 'logs', data: items });
};
