import bunyan from 'bunyan';
import detect = require('detect-port');
import ganache from 'ganache-core';
import Tx from 'ganache-core/lib/utils/transaction';
import Block from 'ganache-core/node_modules/ethereumjs-block';
import * as MokkaEvents from 'mokka/dist/consensus/constants/EventTypes';
import MessageTypes from 'mokka/dist/consensus/constants/MessageTypes';
import * as MokkaStates from 'mokka/dist/consensus/constants/NodeStates';
import NodeStates from 'mokka/dist/consensus/constants/NodeStates';
import {PacketModel} from 'mokka/dist/consensus/models/PacketModel';
import TCPMokka from 'mokka/dist/implementation/TCP';
import semaphore = require('semaphore');
import Web3 = require('web3');
import config from './config';

const logger = bunyan.createLogger({name: 'mokka.logger', level: 60});
const sem = semaphore(1);

const logsStorage: Array<{ key: string, value: string }> = [];
const knownPeersState = new Map<string, number>();

class ExtendedPacketModel extends PacketModel {
  public logIndex: number;
}

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

const startMokka = async (node, server) => {

  // @ts-ignore
  const web3 = new Web3(server.provider);

  const reqMiddleware = async (packet: ExtendedPacketModel): Promise<ExtendedPacketModel> => {
    knownPeersState.set(packet.publicKey, packet.logIndex);

    if (
      packet.state === NodeStates.LEADER &&
      packet.type === MessageTypes.ACK &&
      packet.data &&
      packet.logIndex > logsStorage.length) {

      sem.take(async () => {
        const block = new Block(Buffer.from(packet.data.value, 'hex'));
        block.transactions = block.transactions.map((tx) => new Tx(tx));
        // @ts-ignore
        const replyPacket: ExtendedPacketModel = mokka.messageApi.packet(16);

        const savedBlock = await web3.eth.getBlock(packet.data.index);

        if (savedBlock) {
          replyPacket.logIndex = logsStorage.length;
          await mokka.messageApi.message(replyPacket, packet.publicKey);
          return sem.leave();
        }

        await new Promise((res, rej) => {
          server.provider.manager.state.blockchain.processBlock(
            server.provider.manager.state.blockchain.vm,
            block,
            true,
            (err, data) => err ? rej(err) : res(data)
          );
        });

        logger.info(`new block added ${block.hash().toString('hex')}`);

        logsStorage.push(packet.data);
        replyPacket.logIndex = logsStorage.length;
        await mokka.messageApi.message(replyPacket, packet.publicKey);
        sem.leave();
      });
    }

    return packet;
  };

  const resMiddleware = async (packet: ExtendedPacketModel, peerPublicKey: string): Promise<ExtendedPacketModel> => {
    packet.logIndex = logsStorage.length;
    const peerIndex = knownPeersState.get(peerPublicKey) || 0;

    if (mokka.state === NodeStates.LEADER && packet.type === MessageTypes.ACK && peerIndex < logsStorage.length) {
      packet.data = {...logsStorage[peerIndex], index: peerIndex + 1};
    }

    return packet;
  };

  const customVoteRule = async (packet: ExtendedPacketModel): Promise<boolean> => {
    return packet.logIndex >= logsStorage.length;
  };

  const mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${node.port}/${node.publicKey}`,
    customVoteRule,
    heartbeat: 200,
    logger,
    privateKey: node.secretKey,
    proofExpiration: 30000,
    reqMiddleware,
    resMiddleware
  });
  mokka.on(MokkaEvents.default.STATE, () => {
    logger.info(`changed state ${mokka.state} with term ${mokka.term}`);
  });

  config.nodes.filter((nodec) => nodec.publicKey !== node.publicKey).forEach((nodec) => {
    mokka.nodeApi.join(`tcp://127.0.0.1:${nodec.port}/${nodec.publicKey}`);
  });

  await mokka.connect();
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

  const server = await startGanache(node);
  const mokka = await startMokka(node, server);

  server.provider.engine.on('rawBlock', async (blockJSON) => {

    const block: Block = await new Promise((res, rej) => {
      server.provider.manager.state.blockchain.getBlock(blockJSON.hash, (err, data) => err ? rej(data) : res(data));
    });

    if (mokka.state !== MokkaStates.default.LEADER)
      return;

    logsStorage.push({key: blockJSON.hash, value: block.serialize().toString('hex')});
  });

  const bound = server.provider.send;

  server.provider.send = async (payload, cb) => {

    if (mokka.state !== MokkaStates.default.LEADER && payload.method === 'eth_sendTransaction') {

      const node = config.nodes.find((node) => node.publicKey === mokka.leaderPublicKey);

      // @ts-ignore
      const web3 = new Web3(`http://localhost:${node.ganache}`);

      let hash;

      try {
        hash = await new Promise((res, rej) =>
          web3.eth.sendTransaction(...payload.params, (err, result) => err ? rej(err) : res(result))
        );
      } catch (e) {
        return cb(e, null);
      }

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
