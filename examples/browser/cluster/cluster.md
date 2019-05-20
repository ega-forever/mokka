# Running cluster

In this tutorial we are going to create a simple cluster with 3 members.

## Installation
 
First of all, let's install mokka (via npm):

```bash
$ npm install mokka --save
```

## Prepare keys
As mokka use asymmetric cryptography, we have to create the key pairs for each member of cluster.

``src/gen_keys.js``
```javascript
const nacl = require('tweetnacl');


for (let i = 0; i < 3; i++) {
  const key = nacl.sign.keyPair();
  console.log(`pair[${i + 1}] {publicKey: ${Buffer.from(key.publicKey).toString('hex')}, secretKey: ${Buffer.from(key.secretKey).toString('hex')}`)
}
```
Now let's call the gen_keys: ```bash $ node gen_keys.js```
The output should be similar to this one:
```
pair[1] {publicKey: d6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb, secretKey: 4ca246e3ab29c0085b5cbb797f86e6deea778c6e6584a45764ec10f9e0cebd7fd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb
pair[2] {publicKey: a757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba, secretKey: 931f1c648e1f87b56cd22e8de7ed235b9bd4ade9696c9d8c75f212a1fa401d5da757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba
pair[3] {publicKey: 009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c, secretKey: 7144046b5c55f38cf9b3b7ec53e3263ebb01ed7caf46fe8758d6337c87686077009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c
```

## Mokka implementation

As mokka is agnostic to protocol, we have to implement it (in our case we will use TCP).
First, install the a socket lib for messages exchange: 
```bash
$ npm install axon --save
```
Then create ``src/TCPMokka.js`` and place this:
```javascript

const Mokka = require('mokka');
const msg = require('axon');

class TCPMokka extends Mokka.Mokka {

  constructor (settings){
    super(settings);
    this.sockets = {};
  }

  /**
   * the init function (fires during mokka's init process
   */
  initialize () {
    this.logger.info(`initializing reply socket on port  ${this.address}`);

    this.sockets[this.address] = msg.socket('rep');

    this.sockets[this.address].bind(this.address);

    // here we bind sockets between peers and start listening to new packets
    this.sockets[this.address].on('message', (data) => {
      this.emit('data', data);
    });

    this.sockets[this.address].on('error', () => {
      this.logger.error(`failed to initialize on port: ${this.address}`);
    });
  }

  /**
   * The message to write.
   *
   * @param address the address, to which write msg
   * @param packet the packet to write
   */
  async write (address, packet) {

    if (!this.sockets[address]) {
      this.sockets[address] = msg.socket('req');

      this.sockets[address].connect(address);
      this.sockets[address].on('error', () => {
        this.logger.error(`failed to write to: ${this.address}`);
      });
    }

    this.sockets[address].send(packet);
  }

  async disconnect () {
    await super.disconnect();
    for (const socket of Object.values(this.sockets)) {
      socket.close();
    }
  }

  connect () {
    this.initialize();
    super.connect();
  }

}

module.exports = TCPMokka;


```

## Cluster implementation

Now we need a code, which will boot up the Mokka with certain params. 
Also, this code should accept user input for interaction purpose (in our case via console), 
and logger - for getting logs in appropriate format.
Todo that, type:
```bash
$ npm install readline bunyan --save
```
Now we need to write the cluster implementation ``src/cluster_node.js``

```javascript
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

// get log by index
const getLog = async (mokka, index) => {
  const entry = await mokka.getDb().getEntry().get(parseInt(index));
  mokka.logger.info(entry);
};

// get info of current instance
const getInfo = async (mokka) => {
  const info = await mokka.getDb().getState().getInfo();
  mokka.logger.info(info);
};

module.exports = initMokka();
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