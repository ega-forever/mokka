
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
import bunyan = require('bunyan');
import MokkaEvents from 'mokka/dist/components/shared/constants/EventTypes';
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
    logger.info(`changed state ${mokka.state} with term ${mokka.term}`);
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

  for (const node of mokka.nodes) { // todo
    const info = await mokka.getDb().getState().getInfo();
    mokka.logger.info(info);
  }


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