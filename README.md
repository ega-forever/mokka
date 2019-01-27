# Mokka

Mokka Consensus Algorithm implementation for Node.js.


* Persists to LevelDB (or any database exposing a [LevelDown](https://github.com/level/leveldown) interface).
* Custom transport layer support: Mokka separate interface implementation and consensus.

## Installation

```bash
$ npm install mokka --save
```

## Usage

Client example. In the following example we are going to create the federation of clients:

```javascript
const Log = require('mokka').storage,
  Wallet = require('ethereumjs-wallet'),
  _ = require('lodash'),
  path = require('path'),
  hashUtils = require('mokka/utils/hashes'),
  detectPort = require('detect-port'),
  TCPMokka = require('mokka').implementation.TCP,
  states = require('mokka/node/factories/stateFactory'),
  readline = require('readline');


let mokka = null;

process.on('unhandledRejection', function (reason, p) {
  console.log('Possibly Unhandled Rejection at: Promise ', p, ' reason: ', reason);
  // application specific logging here
  process.exit(0);
});


const startPort = 2000;
const keys = [
  'addfd4bad05a15fb2bbda77f93ecb8f89274ad81cfce48c53c89dac0bb4717b7',
  '36aa6e0db4e8450f8665f69009eb01e73ed49112da217019d810a398a78bc08b',
  'fe2054dd406fa09bf8fbf95fb8aa4abdf045ef32b8c8b7f702571bc8723885fb',
  'fe2054dd406fa09bf8fbf95fb8aa4abdf045ef32b8c8b7f702571bc8723885f1'
];

const initMokka = async () => {


  let index = -1;

  for (let start = 0; start < keys.length; start++) {

    if (index !== -1)
      continue;

    let detectedPort = await detectPort(startPort + start);

    if (detectedPort === startPort + start)
      index = start;
  }

  let uris = [];

  for (let index1 = 0; index1 < keys.length; index1++) {
    if (index === index1)
      continue;
    uris.push(`/ip4/127.0.0.1/tcp/${startPort + index1}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
  }

  const peers = _.chain(pubKeys).cloneDeep().pullAt(index).value();

  mokka = new TCPMokka({
    address: `/ip4/127.0.0.1/tcp/${startPort + index}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index])}`,
    electionMin: 300,
    electionMax: 1000,
    heartbeat: 200,
    Log: Log,
    log_options: {
      adapter: require('leveldown'),
      path: path.join('./', 'dump', `test.${index}.db`)
    },
    logLevel: 30,
    privateKey: keys[index]
  });


  for (let peer of uris)
    mokka.actions.node.join(peer);

  mokka.on('error', function (err) {
    //console.log(err);
  });

  mokka.on('state change', function (state) {
    console.log(`state changed: ${_.invert(states)[state]}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });


  askCommand(rl, mokka);

};


const askCommand = (rl, mokka) => {
  rl.question('enter command > ', async (command) => {

    if (command.indexOf('generate ') === 0) {
      let amount = parseInt(command.replace('generate', '').trim());
      await generateTxs(mokka, amount);
    }

    if(command.indexOf('generate_as_single') === 0){
      let amount = parseInt(command.replace('generate_as_single', '').trim());
      await generateTxsAsSingle(mokka, amount);
    }

    if(command.indexOf('take_ownership') === 0)
      await takeOwnership(mokka);


    askCommand(rl, mokka);
  });

};

const generateTxs = async (mokka, amount) => {

  for (let index = 0; index < amount; index++) {

    let tx = {
      to: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B',
      from: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51',
      nonce: index,
      timestamp: Date.now()
    };

    await mokka.processor.push(tx);
  }

};


const takeOwnership = async (mokka) => {
    await mokka.processor.claimLeadership();
};


const generateTxsAsSingle = async (mokka, amount) => {

  let txs = [];

  for (let index = 0; index < amount; index++) {

    let tx = {
      to: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D5B',
      from: '0x4CDAA7A3dF73f9EBD1D0b528c26b34Bea8828D51',
      nonce: index,
      timestamp: Date.now()
    };

    txs.push(tx);

  }

  await mokka.processor.push(txs);

};


module.exports = initMokka();

```
Then install required deps:
```npm install ethereumjs-wallet detect-port readline```


Finally, run the code in 4 separate shells under the same localhost. You should see some messages about running system. 
Then type ```generate 1``` in order to generate 1 log. In case you wish to generate a big log, then you can just run ```generate_as_single 10```. Also you can start emidiate voting by typing ```take_ownership```.



# API

## Mokka.implementation.TCP (options)

Returns a new mokka node, which use tcp layer for communication

Arguments:

* `address` (string, mandatory): an address in the [multiaddr](https://github.com/multiformats/js-multiaddr#readme) format (example: `"/ip/127.0.0.1/tcp/5398"`).
* `options` (object):
  * `address` (string):  an address in the [multiaddr](https://github.com/multiformats/js-multiaddr#readme) format (example: `"/ip4/127.0.0.1/tcp/2003/ipfs/84U8AxAXjFSHR2XLnq3TuYnyGqQggmTvCYQWqycyutw6wTPdKAiCrqHxB6FcHZxTVSRLJbvaV1bimpcYrJVfWq8uTW"`)
  * `electionMin` (integer): minimum time required for voting
  * `electionMax` (integer): max time required for voting
  * `heartbeat` (integer): leader heartbeat timeout
  * `log` (object): the storage class (as default use ```require('mokka').storage```)
  * `logOptions`: 
    * `adapter`: levelDb compatable adapter (can be leveldown, memdown and so on)
    * `path`: path, where to store logs (in case you use memdown, then you can ommit this option)
  * `logLevel`: logging level. Please take a look at the [bunyan log levels](https://www.npmjs.com/package/bunyan#level-suggestions) for better understanding
  * `privateKey`: the 64 length private key

## mokka.processor.push (log)

push new log and replicate it over the cluster.

## mokka.processor.claimLeadership ()

Runs emmidiate voting process for the current node.

## mokka.log.getPending (hash, isLog = false)

Returns the pending log. Also usabe, when you have the object, which you've pushed and you want to make sure that it was committed, you can pass object and second arg as ```true```.

## mokka.log.getFirstPending ()

Returns first pending from queue.

## mokka.log.getPendingCount ()

Returns total pendings count.

## mokka.log.getEntriesAfter (index, limit)

Returns all committed logs after specified index.

## mokka.log.get (index)

Returns committed log at specified index.

## mokka.log.getByHash (hash)

Returns committed log by specified hash.

## mokka.log.getLastInfo ()

Returns the info about last known state.

## mokka.log.getLastEntry ()

Returns last appended log entry.

## Events

A Mokka instance emits the following events:

* `term_changed`: emits on each term change
* `state_changed`: emits when node change it state (i.e. leader, follower, candidate)
* `leader`: emits when node becomes the leader


# Custom transport layer

By default mokka use the tcp transport layer for sending / accepting packets. However all work with networking has been moved to separate interface. An example can be found in ```mokka/implementation/TCP```. In order to write your own implementation you have to implement 2 methods:
```

 initialize () {
    this.logger.info('initializing reply socket on port %s', this.address);

    this.socket = msg.socket('rep');

    this.socket.bind(this.address);
    this.socket.on('message', (data) => {
      this.emit('data', data);
    });

    this.socket.on('error', () => {
      this.logger.error('failed to initialize on port: ', this.address);
    });
  }

  /**
   * The message to write.
   *
   * @param {Object} packet The packet to write to the connection.
   * @api private
   */
  write (packet) {
    if (!this.socket) {
      this.socket = msg.socket('req');

      this.socket.connect(this.address);
      this.socket.on('error', function err () {
        this.logger.error('failed to write to: ', this.address);
      });
    }

    this.socket.send(packet);
  }
```

The ```initialize``` function fires on mokka start. This method is useful, when you want to open the connection, for instance, tcp one, or connect to certain message broker like rabbitMQ.

The ```write``` function fires each time mokka want to broadcast message to other peer (s). It accepts one argument. The rest of arguments, like address are exposed via context.




# License

[MIT](LICENSE)

# Copyright

Copyright (c) 2018 Egor Zuev