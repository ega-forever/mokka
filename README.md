# Mokka

 [![Build Status](https://www.travis-ci.com/ega-forever/mokka.svg?branch=master)](https://travis-ci.com/ega-forever/mokka) 

Mokka Consensus Algorithm implementation in Node.js.

[Concept description](https://arxiv.org/ftp/arxiv/papers/1901/1901.08435.pdf) (PDF)

[Live Demo](https://ega-forever.github.io/mokka/) (in browser)


consensus features
* resistant to network splits
* non-anonymous voting
* voting validation with musig

implementation features
* Custom transport layer support: Mokka separates interface implementation and consensus
* Fully customizable: you can create your own state machine around Mokka consensus (check out demos for more info)
* Can run in CFT and BFT modes

## Installation

### Via npm
```bash
$ npm install mokka --save
```

### From repo
```bash
$ npm run build
```

# API

### new Mokka (options)

Returns a new Mokka instance. As Mokka is agnostic to protocol implementation, 
you have to create your own.
Please check the ``Custom transport layer`` section.

Arguments:

* `address` (string):  an address in custom format. The only rule is that address should include the public key in the end
 (example: `"tcp://127.0.0.1:2003/03fec1b3d32dbb0641877f65b4e77ba8466f37ab948c0b4780e4ed191be411d694"`)
* `crashModel` (`"CFT" | "BFT"`): crash model, which should run the consensus. The difference is in quorum - CFT requires `f + 1` nodes for quorum, while BFT `2f + 1`
* `heartbeat` (integer): leader heartbeat timeout
* `electionTimeout` (integer): candidate election timeout (i.e. vote round)
* `customVoteRule` (func): additional voting rule
* `reqMiddleware` (func): request middleware (will be triggered on every new packet received)
* `resMiddleware` (func): response middleware (will be triggered on every new packet sent)
* `proofExpiration` (integer): when the leader's proof token should expire.
* `logger` (ILoggerInterface): logger instance. If omitted, then console.log will be used
* `privateKey`: the 64 length private key. Please take a look at [example](examples/node/decentralized-ganache/src/gen_keys.ts) key pair generator

### mokka.join(multiaddr: string): NodeModel

Add new peer node by uri

### await mokka.connect(): Promise<void>

Start consensus. Should be called after all nodes has been added.

### mokka.messageApi.packet(type: number, data: any = null): PacketModel

Create new packet, where ``type`` is packet type, and ``data`` some custom data

### mokka.messageApi.decodePacket(message: Buffer): PacketModel

Decode packet from buffer

### await mokka.messageApi.message(packet: PacketModel, peerPublicKey: string): Promise<void>

Send message to peer

## Events

A Mokka instance emits the following events (available at ``/components/shared/EventTypes.ts``):

* `join`: once we add new peer
* `leave`: once we remove peer
* `heartbeat_timeout`: once we can't receive the heartbeat from leader in certain time (specified in config)
* `state`: once the state of node changed (i.e. leader, candidate, follower)

# Custom RSM

Mokka is a log-less consensus algorithm and doesn't provide any RSM (i.e. replicated log). You have to implement your own. 
However, there is a good example of RSM implementation, which is [similar to RAFT](examples/node/cluster/README.md).

# Custom transport layer

In order to communicate between nodes, you have to implement the interface by yourself. As an example you can take a look at TCP implementation: ```src/implementation/TCP```.
 In order to write your own implementation you have to implement 2 methods:
 
* The ```async initialize()``` function, which fires on Mokka start. This method is useful, when you want to open the connection, for instance, tcp one, or connect to certain message broker like rabbitMQ.

* The ```async write(address: string, packet: Buffer)``` function, which fires each time Mokka wants to broadcast message to other peer (address param).

Also, keep in mind, that Mokka doesn't handle the disconnected / dead peers, which means that Mokka will try to make requests to all presented members in cluster, 
even if they are not available. So, you need to handle it on your own.

# Examples

| Node.js |
| --- | 
| [running cluster](examples/node/cluster/README.md) |
| [running private blockchain](examples/node/decentralized-ganache/README.md) | -

# Implemented protocols out of the box


| Node.js | 
| --- | 
| [TCP](src/implementation/TCP.ts) | 
| [ZMQ](src/implementation/ZMQ.ts) | 


However, you still can implement your own protocol.

# License

[GNU AGPLv3](LICENSE)

# Copyright

Copyright (c) 2018-2021 Egor Zuev
