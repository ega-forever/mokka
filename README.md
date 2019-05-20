# Mokka

 [![Build Status](https://travis-ci.org/ega-forever/mokka.svg?branch=master)](https://travis-ci.org/ega-forever/mokka) 

Mokka Consensus Algorithm implementation in Node.js.

[Concept description](https://arxiv.org/ftp/arxiv/papers/1901/1901.08435.pdf) (PDF)

consensus features
* resistant to network splits
* signature validation of each change in state (i.e. new logs and voting)
* gossip protocol for transferring pending logs
* non-anonymous voting

implementation features
* Persists to LevelDB (or any database exposing a [LevelDown](https://github.com/level/leveldown) interface).
* Custom transport layer support: Mokka separate interface implementation and consensus.
* Custom RSM implementation: you can create your own applier rules.

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

Returns a new mokka instance. As mokka is agnostic to protocol implementation, 
you have to create your own.
Please check the ``Custom transport layer`` section.

Arguments:

* `address` (string):  an address in custom format. The only rule is that address should include the public key in the end
 (example: `"tcp://127.0.0.1:2003/7b85cee8bf60035d1bbccff5c47635733b9818ddc8f34927d00df09c1da80b15"`)
* `electionMin` (integer): minimum time required for voting
* `electionMax` (integer): max time required for voting
* `heartbeat` (integer): leader heartbeat timeout
* `gossipHeartbeat` (integer): gossip heartbeat timeout
* `storage`: levelDb compatible instance (can be leveldown, memdown and so on). Also be sure, that your instance satisfy the interface ```IStorageInterface```. 
* `logger` (ILoggerInterface): logger instance. If omitted, then console.log will be used
* `privateKey`: the 64 length private key. Please take a look at [tweetnacl](https://www.npmjs.com/package/tweetnacl#naclsignkeypair) key pair generator

### mokka.logApi.push (key: string, value: any): void

push new log and replicate it over the cluster.

### await mokka.getDb().getState().getInfo(): Promise<StateModel>

Returns the current state of node (last log index, last committed log index, merkle root)

### await mokka.getDb().getEntry().get(index: number): Promise<EntryModel>

Returns entry (i.e. structure with log), by provided index.

### await mokka.getDb().getEntry().getAfterList (index: number, limit: number): Promise<Array<EntryModel>>

Returns N (specified in limit) logs after specified index.



## Events

A Mokka instance emits the following events (available at ``/components/shared/EventTypes.ts``):

* `join`: once we add new peer
* `leave`: once we remove peer
* `error`: once error happens (for instance, bad voting)
* `heartbeat_timeout`: once we can't receive the heartbeat from leader in certain time (specified in config)
* `state`: once the state of node changed (i.e. leader, candidate, follower)
* `log`: once node received new log
* `log_ack`: once node acked the log

Also gossip expose events. To use them, you have to listen events from gossip instance:
`<mokka_instance>.gossip.on(<event_type>, ()=>{})`

* `peer_new`: once gossip connects to new peer
* `peer_update`: once gossip update information about certain peer
* `peer_alive`: once gossip checked that certain peer alive
* `peer_failed`: once gossip can't receive any answer from certain peer

# Custom transport layer

In order to communicate between nodes, you have to implement the interface by yourself. As an example you can take a look at TCP implementation: ```src/implementation/TCP```.
 In order to write your own implementation you have to implement 2 methods:
 
* The ```async initialize()``` function, which fires on mokka start. This method is useful, when you want to open the connection, for instance, tcp one, or connect to certain message broker like rabbitMQ.

* The ```async write(address: string, packet: Buffer)``` function, which fires each time mokka wants to broadcast message to other peer (address param).

# Examples

| Node.js | Browser |
| --- | --- |
| [running cluster](examples/node/cluster/cluster.md) | [running cluster](examples/node/cluster/cluster.md) |



# License

[GNU AGPLv3](LICENSE)

# Copyright

Copyright (c) 2018-2019 Egor Zuev