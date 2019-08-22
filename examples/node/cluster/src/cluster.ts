import bunyan = require('bunyan');
import {Mokka} from 'mokka/dist/components/consensus/main';
import MokkaEvents from 'mokka/dist/components/shared/constants/EventTypes';
import {StateModel} from 'mokka/dist/components/storage/models/StateModel';
import TCPMokka from 'mokka/dist/implementation/TCP';
import * as readline from 'readline';

// our generated key pairs
const keys = [
  {
    publicKey: '04753d8ac376feba54fabbd7b4cdc512a4350d15e566b4e7398682d13b7a4cf08714182ba08e3b0f7ee61ee857e96dc1799b8f58c61b26ad25b1aa762a9964377a',
    secretKey: 'e3b1e663155437f1810a8c474ddda497bf4a030060374d78dac7cea4dee4e774'
  },
  {
    publicKey: '04b5ef92009db5362540b9416a3bfd4733597b132660e6e50b9b80b4779dae3834eb5c27fdc8767208edafc3b083d353228cb9531ca6e7dda2e9e8990dc1673b1f',
    secretKey: '3cceb8344ddab063cb1c99bf33985bc123a1b85a180baedfd22681471b2541e8'
  },
  {
    publicKey: '04d0c169903b05cd1444f33e14b6feeed8215b232b7be2922e65f3f4d9865cf2148861cd2b3580689fb50ce840c04def59740490230dab76f6645ab159bd6b95c3',
    secretKey: 'fc5c3b5c2366df10b78579751faac46a4507deb205266335c7d9968a0976750b'
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
