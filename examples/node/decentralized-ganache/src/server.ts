import bunyan from 'bunyan';
import detect = require('detect-port');
import ganache from 'ganache-core';
import Tx from 'ganache-core/lib/utils/transaction';
import Block from 'ganache-core/node_modules/ethereumjs-block';
import * as MokkaStates from 'mokka/dist/components/consensus/constants/NodeStates';
import * as MokkaEvents from 'mokka/dist/components/shared/constants/EventTypes';
import TCPMokka from 'mokka/dist/implementation/TCP';
import semaphore = require('semaphore');
import Web3 = require('web3');
import config from './config';

const logger = bunyan.createLogger({name: 'mokka.logger', level: 30});
const sem = semaphore(1);

const startGanache = async (node) => {

  const accounts = config.nodes.map((node) => ({
    balance: node.balance,
    secretKey: `0x${node.secretKey.slice(0, 64)}`
  }));

  const server = ganache.server({
    accounts,
    default_balance_ether: 500,
    network_id: 86,
    time: new Date('12-12-2018')
  });

  await new Promise((res) => {
    server.listen(node.ganache, () => {
      console.log('started');
      res();
    });
  });

  return server;
};

const startMokka = async (node) => {

  const mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${node.port}/${node.publicKey}`,
    electionMax: 300,
    electionMin: 100,
    gossipHeartbeat: 100,
    heartbeat: 50,
    logger,
    privateKey: node.secretKey
  });
  await mokka.connect();
  mokka.on(MokkaEvents.default.STATE, () => {
    logger.info(`changed state ${mokka.state} with term ${mokka.term}`);
  });

  mokka.on(MokkaEvents.default.ERROR, (err) => {
    logger.error(err);
  });

  config.nodes.filter((nodec) => nodec.publicKey !== node.publicKey).forEach((nodec) => {
    mokka.nodeApi.join(`tcp://127.0.0.1:${nodec.port}/${nodec.publicKey}`);

  });

  return mokka;
};

const init = async () => {

  const allocated = await Promise.all(
    config.nodes.map(async (node) =>
      node.ganache === await detect(node.ganache)
    )
  );

  const index = allocated.indexOf(true);

  if (index === -1)
    throw Error('all ports are busy');

  const node = config.nodes[index];

  const mokka = await startMokka(node);
  const server = await startGanache(node);

  server.provider.engine.on('rawBlock', async (blockJSON) => {

    const block: Block = await new Promise((res, rej) => {
      server.provider.manager.state.blockchain.getBlock(blockJSON.hash, (err, data) => err ? rej(data) : res(data));
    });

    if (mokka.state !== MokkaStates.default.LEADER)
      return;

    await mokka.logApi.push(blockJSON.hash, {value: block.serialize().toString('hex'), nonce: Date.now()});
  });

  mokka.on(MokkaEvents.default.LOG, (index) => {

    if (mokka.state === MokkaStates.default.LEADER)
      return;

    sem.take(async () => {
      const {log} = await mokka.getDb().getEntry().get(index);
      const block = new Block(Buffer.from(log.value.value, 'hex'));
      block.transactions = block.transactions.map((tx) => new Tx(tx));

      await new Promise((res, rej) => {
        server.provider.manager.state.blockchain.processBlock(
          server.provider.manager.state.blockchain.vm,
          block,
          true,
          (err, data) => err ? rej(err) : res(data)
        );
      });

      logger.info(`new block added ${block.hash().toString('hex')}`);

      sem.leave();
    });

  });

  const bound = server.provider.send;

  server.provider.send = async (payload, cb) => {

    if (mokka.state !== MokkaStates.default.LEADER && payload.method === 'eth_sendTransaction') {

      const node = config.nodes.find((node) => node.publicKey === mokka.leaderPublicKey);

      console.log(node)

      // @ts-ignore
      const web3 = new Web3(`http://localhost:${node.ganache}`);
      const hash = await new Promise((res, rej) =>
        web3.eth.sendTransaction(...payload.params, (err, result) => err ? rej(err) : res(result))
      );

      // await until tx will be processed
      await new Promise((res) => {
        const intervalPid = setInterval(async () => {

          const tx = await new Promise((res, rej) =>
            server.provider.manager.eth_getTransactionByHash(
              hash,
              (err, result) => err ? rej(err) : res(result)
            )
          );

          if (tx) {
            clearInterval(intervalPid);
            res();
          }

        }, 200);
      });

      const reply = {
        id: payload.id,
        jsonrpc: payload.jsonrpc,
        result: hash
      };

      return cb(null, reply);
    }

    return bound.call(server.provider, payload, cb);
  };
};

module.exports = init();
