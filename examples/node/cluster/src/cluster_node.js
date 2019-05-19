const TCPMokka = require('./TCPMokka'),
  MokkaEvents = require('mokka/dist/components/shared/constants/EventTypes'),
  bunyan = require('bunyan'),
  readline = require('readline');

// our generated key pairs
const keys = [
  {
    publicKey: 'd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb',
    secretKey: '4ca246e3ab29c0085b5cbb797f86e6deea778c6e6584a45764ec10f9e0cebd7fd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb'
  },
  {
    publicKey: 'a757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba',
    secretKey: '931f1c648e1f87b56cd22e8de7ed235b9bd4ade9696c9d8c75f212a1fa401d5da757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba'
  },
  {
    publicKey: '009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c',
    secretKey: '7144046b5c55f38cf9b3b7ec53e3263ebb01ed7caf46fe8758d6337c87686077009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c'
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
    electionMin: 300,
    electionMax: 1000,
    heartbeat: 200,
    gossipHeartbeat: 200,
    logger,
    privateKey: keys[index].secretKey
  });
  mokka.connect();
  mokka.on(MokkaEvents.default.STATE, () => {
    logger.info(`changed state ${mokka.state} with term ${mokka.term}`);
  });
  for (const peer of uris)
    mokka.nodeApi.join(peer);
  mokka.on(MokkaEvents.default.ERROR, (err) => {
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
    if (args[0] === 'info')
      await getInfo(mokka);
    askCommand(rl, mokka);
  });
};

// add new log
const addLog = async (mokka, key, value) => {
  await mokka.logApi.push(key, {value, nonce: Date.now()});
};

// get info of current instance
const getInfo = async (mokka) => {
  const info = await mokka.getDb().getState().getInfo();
  mokka.logger.info(info);
};

module.exports = initMokka();