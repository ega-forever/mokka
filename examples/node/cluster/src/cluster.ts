import bunyan = require('bunyan');
import MokkaEvents from 'mokka/dist/consensus/constants/EventTypes';
import MessageTypes from 'mokka/dist/consensus/constants/MessageTypes';
import NodeStates from 'mokka/dist/consensus/constants/NodeStates';
import {PacketModel} from 'mokka/dist/consensus/models/PacketModel';
import TCPMokka from 'mokka/dist/implementation/TCP';
import * as readline from 'readline';

class ExtendedPacketModel extends PacketModel {
  public logIndex: number;
  public log: { key: string, value: string, index: number };
}

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

const logsStorage: Array<{ key: string, value: string, index: number }> = [];
const knownPeersState = new Map<string, number>();

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

  const logger = bunyan.createLogger({name: 'mokka.logger', level: 10});

  const reqMiddleware = async (packet: ExtendedPacketModel): Promise<ExtendedPacketModel> => {
    knownPeersState.set(packet.publicKey, packet.logIndex);
    const lastIndex = logsStorage[logsStorage.length - 1] ? logsStorage[logsStorage.length - 1].index : 0;

    if (
      packet.state === NodeStates.LEADER &&
      packet.type === MessageTypes.ACK &&
      packet.log &&
      packet.log.index > lastIndex) {
      logsStorage.push(packet.log);
      // @ts-ignore
      const replyPacket: ExtendedPacketModel = mokka.messageApi.packet(16);
      replyPacket.logIndex = packet.log.index;
      await mokka.messageApi.message(replyPacket, packet.publicKey);
    }

    return packet;
  };

  const resMiddleware = async (packet: ExtendedPacketModel, peerPublicKey: string): Promise<ExtendedPacketModel> => {
    packet.logIndex = logsStorage.length ? logsStorage[logsStorage.length - 1].index : 0;
    const peerIndex = knownPeersState.get(peerPublicKey) || 0;

    if (mokka.state === NodeStates.LEADER && packet.type === MessageTypes.ACK && peerIndex < packet.logIndex) {
      packet.log = logsStorage.find((item) => item.index === peerIndex + 1);
    }

    return packet;
  };

  const customVoteRule = async (packet: ExtendedPacketModel): Promise<boolean> => {
    const lastIndex = logsStorage[logsStorage.length - 1] ? logsStorage[logsStorage.length - 1].index : 0;
    return packet.logIndex >= lastIndex;
  };

  const mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${startPort + index}/${keys[index].publicKey}`,
    customVoteRule,
    electionTimeout: 300,
    heartbeat: 200,
    logger,
    privateKey: keys[index].secretKey,
    proofExpiration: 20000,
    reqMiddleware,
    resMiddleware
  });
  mokka.on(MokkaEvents.STATE, () => {
    // logger.info(`changed state ${mokka.state} with term ${mokka.term}`);
  });
  for (const peer of uris)
    mokka.nodeApi.join(peer);

  mokka.connect();

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
      addLog(mokka, args[1], args[2]);
    }

    if (args[0] === 'get_log') {
      await getLog(mokka, args[1]);
    }

    if (args[0] === 'info')
      await getInfo(mokka);

    askCommand(rl, mokka);
  });
};

// add new log
const addLog = async (mokka, key, value) => {

  if (mokka.state !== NodeStates.LEADER) {
    return console.log('i am not a leader');
  }

  logsStorage.push({key, value, index: logsStorage.length + 1});
};

// get log by index

const getLog = async (mokka, index) => {
  mokka.logger.info(logsStorage.find((item) => item.index === index));
};

// get info of current instance

const getInfo = async (mokka) => {
  console.log({index: logsStorage.length, peersState: knownPeersState});
};

initMokka();
