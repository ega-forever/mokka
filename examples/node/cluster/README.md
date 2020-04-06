
# Running cluster

In this tutorial we are going to create a simple cluster with 3 members.

## Installation
 
First of all, let's install mokka (via npm):

```bash
$ npm install mokka --save
```

## Prepare keys
As mokka use asymmetric cryptography, we have to create the key pairs for each member of cluster.

``src/gen_keys.ts``
```javascript
import crypto from 'crypto';

for (let i = 0; i < 3; i++) {
  const node = crypto.createECDH('secp256k1');
  node.generateKeys('hex');
  console.log(`pair[${i + 1}] {publicKey: ${node.getPublicKey('hex')}, secretKey: ${node.getPrivateKey('hex')}`);
}
```
Now let's call the gen_keys: ```bash $ node gen_keys.ts```
The output should be similar to this one:
```
pair[1] {publicKey: 04c966d69cad83cba9290b4fb2cfd79aaef114215fa0ec3b361154d0cf6d54f2e34034c5628dfef87316b6dd07e6ac15f671debdaaa3d19e9d0353d212b2c0db43, secretKey: fe15d6a3e13b8c3d56fd529a6e2b315a0a8634c5519100b35c3078a847871b58
pair[2] {publicKey: 044b2879f5f8360e060e5ed5bb8e954808dd81b57bcedf290611e98b8a78e39a163a11b9bc722a39554f4d761ca96e1ea280e0a628ab2aff64bae5ed0592133786, secretKey: 905bf7936ed38eb6dd975685716eed401aa988b760a75f5367321c20e5ade917
pair[3] {publicKey: 04609211f57ff99d6039b1a2d7aa7c2ffdb72d06911b2fd82386b0b880e8514a72a00952be54ec337daf1d11853e7b66b3bbab9428cbae1bfc99c1c9b9bcf6c4b4, secretKey: 46d6e16dbaed771eb899aa8c845578ed354a01cef1928a7f2feccfe04c5b22a0
```

## Mokka implementation

As mokka is agnostic to protocol, we have to implement it, or take exciting one from implementations (in our case we will take TCP).
Also we will need to install the a socket lib for messages exchange (used by TCP implementation): 
```bash
$ npm install axon --save
```

## Cluster implementation

Now we need a code, which will boot up the Mokka with certain params. 
Also, this code should accept user input for interaction purpose (in our case via console), 
and logger - for getting logs in appropriate format.
Todo that, type:
```bash
$ npm install readline bunyan --save
```
Now we need to write the cluster implementation ``src/cluster.ts``

```javascript

class ExtendedPacketModel extends PacketModel {
  public logIndex: number;
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

const logsStorage: Array<{ key: string, value: string }> = [];
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

  const logger = bunyan.createLogger({name: 'mokka.logger', level: 30});

  const reqMiddleware = async (packet: ExtendedPacketModel): Promise<ExtendedPacketModel> => {
    knownPeersState.set(packet.publicKey, packet.logIndex);

    if (
      packet.state === NodeStates.LEADER &&
      packet.type === MessageTypes.ACK &&
      packet.data &&
      packet.logIndex > logsStorage.length) {
      logsStorage.push(packet.data);
      // @ts-ignore
      const replyPacket: ExtendedPacketModel = mokka.messageApi.packet(16);
      replyPacket.logIndex = logsStorage.length;
      await mokka.messageApi.message(replyPacket, packet.publicKey);
    }

    return packet;
  };

  const resMiddleware = async (packet: ExtendedPacketModel, peerPublicKey: string): Promise<ExtendedPacketModel> => {
    packet.logIndex = logsStorage.length;
    const peerIndex = knownPeersState.get(peerPublicKey) || 0;

    if (mokka.state === NodeStates.LEADER && packet.type === MessageTypes.ACK && peerIndex < logsStorage.length) {
      packet.data = logsStorage[peerIndex];
    }

    return packet;
  };

  const customVoteRule = async (packet: ExtendedPacketModel): Promise<boolean> => {
    return packet.logIndex >= logsStorage.length;
  };

  const mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${startPort + index}/${keys[index].publicKey}`,
    customVoteRule,
    electionTimeout: 300,
    heartbeat: 200,
    logger,
    privateKey: keys[index].secretKey,
    proofExpiration: 60000,
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

  logsStorage.push({key, value});
};

// get log by index

const getLog = async (mokka, index) => {
  mokka.logger.info(logsStorage[index]);
};

// get info of current instance

const getInfo = async (mokka) => {
  console.log({index: logsStorage.length, peersState: knownPeersState});
};

initMokka();

```

Each instance should have its own index, specified in env.
By this index, we will pick up the current key pair and port 
for tcp server (i.e. 2000 + index).

Also, you can move the start script to ``scripts`` section in package.json:
```
...
  "scripts": {
    "run_1": "set INDEX=0 && node src/cluster_node.js",
    "run_2": "set INDEX=1 && node src/cluster_node.js",
    "run_3": "set INDEX=2 && node src/cluster_node.js"
  },
  ...
```



## Usage

Now we can run out cluster. So, you have to open 3 terminals and type in each terminal the appropriate command:
terminal 1: ```npm run run_1```
terminal 2: ```npm run run_2```
terminal 3: ```npm run run_3```

In order to generate new log with key "super" and value "test", type: 
```
add_log super test
```
To get instance state, type:
```
info
```

To get log by index, for instance 3, type:
```
get_log 3
```

That's all, now you can easily boot your own cluster. 
All source code can be found under ``examples/node/cluster``.
In case, you are going to run the demo from mokka's repo, then first run: ```npm run build_dist``` for generating mokka dist folder.