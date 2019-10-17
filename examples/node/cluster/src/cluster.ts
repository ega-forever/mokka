import bunyan = require('bunyan');
import {Mokka} from 'mokka/dist/components/consensus/main';
import MokkaEvents from 'mokka/dist/components/shared/constants/EventTypes';
import {StateModel} from 'mokka/dist/components/storage/models/StateModel';
import TCPMokka from 'mokka/dist/implementation/TCP';
import * as readline from 'readline';

// our generated key pairs
const keys = [
  {
    publicKey: '0263920784223e0f5aa31a4bcdae945304c1c85df68064e9106ebfff1511221ee9',
    secretKey: '507b1433f58edd4eff3e87d9ba939c74bd15b4b10c00c548214817c0295c521a'
  },
  {
    publicKey: '024ad0ef01d3d62b41b80a354a5b748524849c28f5989f414c4c174647137c2587',
    secretKey: '3cb2530ded6b8053fabf339c9e10e46ceb9ffc2064d535f53df59b8bf36289a1'
  },
  {
    publicKey: '02683e65682deeb98738b44f8eb9d1840852e5635114c7c4ef2e39f20806b96dbf',
    secretKey: '1c954bd0ecc1b2c713b88678e48ff011e53d53fc496458063116a2e3a81883b8'
  }
];

const startPort = 2000;

// init mokka instance, bootstrap other nodes, and call the askCommand
const initMokka = async () => {
  const index = parseInt(process.env.INDEX, 10);
  const uris = [];
  for (let index1 = 0; index1 < keys.length; index1++) {
    if (index === index1)
      continue;
    uris.push(`tcp://127.0.0.1:${startPort + index1}/${keys[index1].publicKey}`);
  }

  const logger = bunyan.createLogger({name: 'mokka.logger', level: 30});

  const mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${startPort + index}/${keys[index].publicKey}`,
    electionMax: 300,
    electionMin: 100,
    gossipHeartbeat: 200,
    heartbeat: 100,
    logger,
    privateKey: keys[index].secretKey
  });
  mokka.connect();
  mokka.on(MokkaEvents.STATE, () => {
    // logger.info(`changed state ${mokka.state} with term ${mokka.term}`);
  });
  for (const peer of uris)
    mokka.nodeApi.join(peer);
  mokka.on(MokkaEvents.ERROR, (err) => {
    logger.error(err);
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  askCommand(rl, mokka);
};

// listens to user's input via console
const askCommand = (rl, mokka) => {
  rl.question('enter command > ', async (command) => {

    const args = command.split(' ');

    if (args[0] === 'add_log') {
      await addLog(mokka, args[1], args[2]);
    }

    if (args[0] === 'add_logs') {
      await addManyLogs(mokka, args[1]);
    }

    if (args[0] === 'get_log') {
      await getLog(mokka, args[1]);
    }

    if (args[0] === 'info')
      await getInfo(mokka);

    if (args[0] === 'get_nodes') {
      await getNodes(mokka);
    }

    if (args[0] === 'reset_node') {
      await resetNode(mokka, args[1]);
    }

    askCommand(rl, mokka);
  });
};

// add new log
const addLog = async (mokka, key, value) => {
  await mokka.logApi.push(key, {value, nonce: Date.now()});
};

const addManyLogs = async (mokka, count) => {
  for (let i = 0; i < count; i++)
    await mokka.logApi.push('123', {value: Date.now(), nonce: Date.now()});
};

// get log by index
const getLog = async (mokka, index) => {
  const entry = await mokka.getDb().getEntry().get(parseInt(index, 10));
  mokka.logger.info(entry);
};

// get info of current instance
const getInfo = async (mokka) => {
  const info = await mokka.getDb().getState().getInfo();
  mokka.logger.info(info);
  const info2 = mokka.getLastLogState();
  console.log({...info2, state: mokka.state});
};

const getNodes = async (mokka: Mokka) => {
  const keys = Array.from(mokka.nodes.keys());
  for (let index = 0; index < mokka.nodes.size; index++) {
    console.log(`node ${index} / ${mokka.nodes.get(keys[index]).address} with state ${mokka.nodes.get(keys[index]).getLastLogState().index}`);
  }
};

const resetNode = async (mokka: Mokka, index) => {
  const keys = Array.from(mokka.nodes.keys());
  mokka.nodes.get(keys[index]).setLastLogState(new StateModel());
};

initMokka();
