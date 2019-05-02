// @ts-ignore
import * as _ from 'lodash';
import * as path from 'path';
import * as readline from 'readline';
import {Mokka} from '../components/consensus/main';
import TCPMokka from '../implementation/TCP';

let mokka: Mokka = null;

process.on('unhandledRejection', (reason, p) => {
  console.log('Possibly Unhandled Rejection at: Promise ', p, ' reason: ', reason);
  // application specific logging here
  process.exit(0);
});

console.log('index ' + process.env.INDEX);

const startPort = 2000;
const keys = [
  'f7954a52cb4e6cb8a83ed0d6150a3dd1e4ae2c150054660b14abbdc23e16262b7b85cee8bf60035d1bbccff5c47635733b9818ddc8f34927d00df09c1da80b15',
  '5530a97b921df76755c34e2dddee729072c425b5de4a273df60418f869eb2c9d796d8cf388c2a4ed8cb9f4c6fe9cfc1b1cdbdcf5edf238961f8915b9979f89b1',
  '459136f8dbf054aa9c7be317d98f8bfea97dfe2726e6c56caf548680c074b05df9177556775896385a3e525e53f77fed09f2a88def0d1ebb67f539b33cbd98b1',
  '644ae3a446e8d48760155dbf53167664bc89831039ab8f86957a00e411055b943b44191e5d19513dc5df07aa776943a9ef985c1546bcdcee0d74de66b095272c'
];

const initMokka = async () => {

  const index = parseInt(process.env.INDEX, 10);
  const uris = [];

  for (let index1 = 0; index1 < keys.length; index1++) {
    if (index === index1)
      continue;
    uris.push(`/ip4/127.0.0.1/tcp/${startPort + index1}/${keys[index1].substring(64, 128)}`);
  }

  mokka = new TCPMokka({
    address: `/ip4/127.0.0.1/tcp/${startPort + index}/${keys[index].substring(64, 128)}`,
    electionMin: 300,
    electionMax: 1000,
    heartbeat: 200,
    gossipHeartbeat: 200,
    gossipTimeout: 200,
    storage: {
      adapter: require('memdown')
    },
    logLevel: 30,
    privateKey: keys[index],
    applier: async (command: any, state: any) => {
      let value = await state.get(command.key);
      value = (value || 0) + parseInt(command.value.value, 10);
      await state.put(command.key, value);
    }
  });

  mokka.connect();

  mokka.on('state', () => {
    console.log(`changed state ${mokka.state} with term ${mokka.term}`);
  });

  for (const peer of uris)
    mokka.nodeApi.join(peer);

  mokka.on('error', (err) => {
    console.log(err);
  });

  /*  mokka.on('state change', function (state) {
      console.log(`state changed: ${_.invert(states)[state]}`);
    });*/

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  askCommand(rl, mokka);

};

const askCommand = (rl: any, mokka: Mokka) => {
  rl.question('enter command > ', async (command: string) => {

    if (command.indexOf('generate ') === 0) {
      const amount = parseInt(command.replace('generate', '').trim(), 10);
      await generateTxs(mokka, amount);
    }

    if (command.indexOf('get_state') === 0)
      await getState(mokka);

    /*

        if (command.indexOf('take_snapshot') === 0)
          await takeSnapshot(mokka, command.replace('take_snapshot', '').trim());

        if (command.indexOf('append_snapshot') === 0)
          await appendSnapshot(mokka, command.replace('append_snapshot', '').trim());
    */

    askCommand(rl, mokka);
  });

};

const generateTxs = async (mokka: Mokka, amount: number) => {

  for (let index = 0; index < amount; index++) {
    const value = _.random(-10, Date.now());
    console.log(`changing value to + ${value}`);
    await mokka.logApi.push('0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B', {value: value.toString(), nonce: Date.now()});
  }

};

const getState = async (mokka: Mokka) => {
  let state = await mokka.getDb().getState().getAll(false, 0, 100000, mokka.applier);
  state = _.chain(state).toPairs().sortBy((pair) => pair[0]).fromPairs().value();

  console.log(require('util').inspect(state, null, 2));
  console.log(`total keys: ${Object.keys(state).length}`);
  const info = await mokka.getDb().getState().getInfo();
  console.log(info);
};

/*
const takeSnapshot = async (mokka, path) => {
  await mokka.log.state.takeSnapshot(path);
};

const appendSnapshot = async (mokka, path) => {
  await mokka.log.state.appendSnapshot(path);
};
*/

module.exports = initMokka();
