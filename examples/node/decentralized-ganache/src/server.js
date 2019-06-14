const ganache = require('ganache-core'),
  config = require('./config'),
  TCPMokka = require('./TCPMokka'),
  bunyan = require('bunyan'),
  Web3 = require('web3'),
  request = require('request-promise'),
  sem = require('semaphore')(1),
  Tx = require('ganache-core/lib/utils/transaction'),
  Block = require('ganache-core/node_modules/ethereumjs-block'),
  MokkaEvents = require('mokka/dist/components/shared/constants/EventTypes'),
  MokkaStates = require('mokka/dist/components/consensus/constants/NodeStates'),
  detect = require('detect-port');

const logger = bunyan.createLogger({name: 'mokka.logger', level: 30});

const startGanache = async (node) => {

  const accounts = config.nodes.map(node => ({
    secretKey: Buffer.from(node.secretKey.slice(64), 'hex'),
    balance: node.balance
  }));

  const server = ganache.server({
    accounts: accounts,
    default_balance_ether: 500,
    network_id: 86
  });

  await new Promise(res => {
    server.listen(node.ganache, () => {
      console.log('started');
      res();
    });
  });

  return server;
};

const startMokka = (node) => {

  const mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${node.port}/${node.publicKey}`,
    electionMin: 300,
    electionMax: 1000,
    heartbeat: 200,
    gossipHeartbeat: 200,
    logger,
    privateKey: node.secretKey
  });
  mokka.connect();
  mokka.on(MokkaEvents.default.STATE, () => {
    logger.info(`changed state ${mokka.state} with term ${mokka.term}`);
  });

  mokka.on(MokkaEvents.default.ERROR, (err) => {
    logger.error(err);
  });

  config.nodes.filter(nodec => nodec.publicKey !== node.publicKey).forEach(nodec => {
    mokka.nodeApi.join(`tcp://127.0.0.1:${nodec.port}/${nodec.publicKey}`);

  });

  return mokka;
};


const init = async () => {

  const allocated = await Promise.all(
    config.nodes.map(async node =>
      node.ganache === await detect(node.ganache)
    )
  );

  const index = allocated.indexOf(true);

  if (index === -1)
    throw Error('all ports are busy');

  const node = config.nodes[index];

  const mokka = startMokka(node);
  const server = await startGanache(node, mokka);


  //todo retranslate send_tx request to leader
  // todo we should send to mokka the transaction


  server.provider.engine.on('rawBlock', async blockJSON => {

    const block = await new Promise((res, rej) => {
      server.provider.manager.state.blockchain.getBlock(blockJSON.hash, (err, data) => err ? rej(data) : res(data))
    });

    if (mokka.state !== MokkaStates.default.LEADER)
      return;

    await mokka.logApi.push(blockJSON.hash, {value: block.serialize().toString('hex'), nonce: Date.now()});
  });

  mokka.on(MokkaEvents.default.LOG, (index) => { //todo make mutex

    if (mokka.state === MokkaStates.default.LEADER)
      return;

    sem.take(async () => {
      const {log} = await mokka.getDb().getEntry().get(index);
      const block = new Block(Buffer.from(log.value.value, 'hex'));
      block.transactions = block.transactions.map(tx => new Tx(tx));

      await new Promise((res, rej) => {
        server.provider.manager.state.blockchain.processBlock(
          server.provider.manager.state.blockchain.vm,
          block,
          true,
          (err, data) => err ? rej(err) : res(data)
        )
      });

      logger.info(`new block added ${block.hash().toString('hex')}`);

      sem.leave();
    });


  });


  const bound = server.provider.send;

  server.provider.send = async (payload, cb) => {

    console.log(payload)

    if (payload.method === 'eth_sendTransaction' && mokka.state !== MokkaStates.default.LEADER) {

      const node = config.nodes.find(node => node.publicKey === mokka.leaderPublicKey);

      const web3 = new Web3(`http://localhost:${node.ganache}`);
      const hash = await new Promise((res, rej) =>
        web3.eth.sendTransaction(...payload.params, (err, result) => err ? rej(err) : res(result))
      );


      const reply = {
        jsonprc: payload.jsonrpc,
        id: payload.id,
        result: hash
      };

      return cb(null, reply);
    }

    return bound.call(server.provider, payload, cb)
  };


};


process.on('unhandledRejection', error => {
  // Will print "unhandledRejection err is not defined"
  console.log('unhandledRejection', error);
});


module.exports = init();