# Running decentralized ganache

In this tutorial we are going to create a simple ganache instance with running mokka consensus behind.

## Installation
 
First of all, let's install mokka, ganache and other required stuff (via npm):

```bash
$ npm install mokka ganache-core tweetnacl bunyan web3 --save
```


## Prepare keys
As mokka use asymmetric cryptography, we have to create the key pairs for each member of cluster.

``src/gen_keys.ts``
```javascript
const nacl = require('tweetnacl');


for (let i = 0; i < 3; i++) {
  const key = nacl.sign.keyPair();
  console.log(`pair[${i + 1}] {publicKey: ${Buffer.from(key.publicKey).toString('hex')}, secretKey: ${Buffer.from(key.secretKey).toString('hex')}`)
}
```
Now let's call the gen_keys: ```bash $ node src/gen_keys.ts```
The output should be similar to this one:
```
pair[1] {publicKey: d6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb, secretKey: 4ca246e3ab29c0085b5cbb797f86e6deea778c6e6584a45764ec10f9e0cebd7fd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb
pair[2] {publicKey: a757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba, secretKey: 931f1c648e1f87b56cd22e8de7ed235b9bd4ade9696c9d8c75f212a1fa401d5da757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba
pair[3] {publicKey: 009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c, secretKey: 7144046b5c55f38cf9b3b7ec53e3263ebb01ed7caf46fe8758d6337c87686077009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c
```

## Mokka implementation

As mokka is agnostic to protocol, we have to implement it (in our case we will use TCP).
First, install the socket lib for messages exchange: 
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

Each node in cluster will represent the ganache instance with mokka's client. 
In order to make the ganache decentralized, we have to think about 3 things:
1) an ability to broadcast pending changes (like unconfirmed tx)
2) an ability to mine and broadcast the blocks
3) concurrency and sync issues



In order to overcome the first problem, we will override the send method in ganache instance, so in case the node (which accepts the request) 
is follower, it rebroadcast the request to the leader node. This logic only touch send_transaction request.

The second problem will be resolved thanks to mokka consensus engine: once the leader receive the pending transaction, it applies it and mint new block.
This block will be broadcasted with mokka to all followers. Then each follower apply this block to its state.

The third issue will be resolved thanks to previous two.  


First of all, we have to create the config, where we will specify 
all options for each node ``src/config.js``:

```javascript
module.exports ={
  nodes: [
    {
      publicKey: 'd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb',
      secretKey: '4ca246e3ab29c0085b5cbb797f86e6deea778c6e6584a45764ec10f9e0cebd7fd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb',
      ganache: 8545,
      port: 3000,
      balance: '10'.padEnd(20, '0')

    },
    {
      publicKey: 'a757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba',
      secretKey: '931f1c648e1f87b56cd22e8de7ed235b9bd4ade9696c9d8c75f212a1fa401d5da757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba',
      ganache: 8546,
      port: 3001,
      balance: '10'.padEnd(20, '0')
    },
    {
      publicKey: '009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c',
      secretKey: '7144046b5c55f38cf9b3b7ec53e3263ebb01ed7caf46fe8758d6337c87686077009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c',
      ganache: 8547,
      port: 3002,
      balance: '10'.padEnd(20, '0')
    }
  ]
};
```



Now we need a code, which will boot up the Mokka and ganache with certain params. 
Also, for demo purpose, we will write the logic, where mokka bootup peer based on first free port among specified in config.
Todo that, we need to install a lib, which will detect if certain port is free:
```bash
$ npm install detect-port --save
```

Now we need to write the cluster implementation ``src/server.js``

```javascript
const ganache = require('ganache-core'),
  config = require('./config'),
  TCPMokka = require('./TCPMokka'),
  bunyan = require('bunyan'),
  Web3 = require('web3'),
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
    network_id: 86,
    time: new Date('12-12-2018')
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


  server.provider.engine.on('rawBlock', async blockJSON => {

    const block = await new Promise((res, rej) => {
      server.provider.manager.state.blockchain.getBlock(blockJSON.hash, (err, data) => err ? rej(data) : res(data))
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

    if (mokka.state !== MokkaStates.default.LEADER && payload.method === 'eth_sendTransaction') {

      const node = config.nodes.find(node => node.publicKey === mokka.leaderPublicKey);

      const web3 = new Web3(`http://localhost:${node.ganache}`);
      const hash = await new Promise((res, rej) =>
        web3.eth.sendTransaction(...payload.params, (err, result) => err ? rej(err) : res(result))
      );

      // await until tx will be processed
      await new Promise(res => {
        let intervalPid = setInterval(async () => {

          const tx = await new Promise((res, rej) =>
            server.provider.manager.eth_getTransactionByHash(
              hash,
              (err, result) => err ? rej(err) : res(result)
            )
          );

          if (tx) {
            clearInterval(intervalPid);
            res()
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

    return bound.call(server.provider, payload, cb)
  };
};


module.exports = init();
```


## Usage

Now we can run out cluster. So, you have to open 3 terminals and type in each terminal the appropriate command:
terminal 1: ```node src/server```
terminal 2: ```node src/server```
terminal 3: ```node src/server```

Now you can connect to any node (i.e. ports 8545, 8546 or 8547) via web3, or geth client and start using the cluster.
All source code is available under the current directory.