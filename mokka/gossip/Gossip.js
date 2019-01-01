const PeerState = require('./peer_state').PeerState,
  Scuttle = require('./scuttle').Scuttle,
  EventEmitter = require('events'),
  net = require('net'),
  msgpack = require('msgpack');

Gossip.REQUEST = 0;
Gossip.FIRST_RESPONSE = 1;
Gossip.SECOND_RESPONSE = 2;

class Gossip extends EventEmitter {

  constructor (mokka) {
    super();
    this.mokka = mokka;


    this.peers = {};
    this.ip_to_bind = ip_to_bind;
    this.port = port;
    this.seeds = seeds;
    this.my_state = new PeerState();
    this.scuttle = new Scuttle(this.peers, this.my_state);

    this.handleNewPeers(seeds);
  }

  start () {
    this.heartBeatTimer = setInterval(() => this.my_state.beatHeart(), 1000);//todo replace with heartbeat from mokka (ack packet)
    this.gossipTimer = setInterval(() => this.gossip(), 1000);
  }


  stop () {
    clearInterval(this.heartBeatTimer);
    clearInterval(this.gossipTimer);
  }


  gossip () {

    const live_peer = this.livePeers().length > 0 ? this.chooseRandom(this.livePeers()) : null;

    if (live_peer)
      this.gossipToPeer(live_peer);

    // Possilby gossip to a dead peer
    let prob = this.deadPeers().length / (this.livePeers().length + 1);
    if (Math.random() < prob) {
      let dead_peer = this.chooseRandom(this.deadPeers());
      this.gossipToPeer(dead_peer);
    }

    // Gossip to seed under certain conditions
    if (live_peer && !this.seeds[live_peer] && this.livePeers().length < this.seeds.length)
      if (Math.random() < (this.seeds / this.allPeers.size()))
        this.gossipToPeer(chooseRandom(this.peers));


    // Check health of peers
    for (let peer of this.peers)
      if (peer !== this.my_state)
        peer.isSuspect();
  }


  chooseRandom (peers) {
    let i = Math.floor(Math.random() * 1000000) % peers.length;
    return peers[i];
  }

  gossipToPeer (peer) { //todo refactor
    var a = peer.split(':');
    var gosipee = new net.createConnection(a[1], a[0]);
    var self = this;
    gosipee.on('connect', function (net_stream) {
      var mp_stream = new msgpack.Stream(gosipee);
      mp_stream.on('msg', function (msg) {
        self.handleMessage(gosipee, mp_stream, msg)
      });
      mp_stream.send(self.requestMessage());
    });
    gosipee.on('error', function (exception) {
//    console.log(self.peer_name + " received " + util.inspect(exception));
    });
  }


  handleMessage (net_stream, mp_stream, msg) {
    switch (msg.type) {
      case Gossip.REQUEST:
        mp_stream.send(this.firstResponseMessage(msg.digest));
        break;
      case Gossip.FIRST_RESPONSE:
        this.scuttle.updateKnownState(msg.updates);
        mp_stream.send(this.secondResponseMessage(msg.request_digest));
        net_stream.end();
        break;
      case Gossip.SECOND_RESPONSE:
        this.scuttle.updateKnownState(msg.updates);
        net_stream.end();
        break;
      default:
        // shit went bad
        break;
    }
  }


  handleNewPeers (new_peers) {
    for (let peer_name in new_peers) {
      this.peers[peer_name] = new PeerState(peer_name);
      this.emit('new_peer', peer_name);

      let peer = this.peers[peer_name];
      this.listenToPeer(peer);
    }
  }


  listenToPeer (peer) {
    var self = this;
    peer.on('update', function (k, v) {
      self.emit('update', peer.name, k, v);
    });
    peer.on('peer_alive', function () {
      self.emit('peer_alive', peer.name);
    });
    peer.on('peer_failed', function () {
      self.emit('peer_failed', peer.name);
    });
  }


  requestMessage () {
    return {
      'type': Gossiper.REQUEST,
      'digest': this.scuttle.digest()
    };
  };


  firstResponseMessage (peer_digest) {
    let sc = this.scuttle.scuttle(peer_digest);
    this.handleNewPeers(sc.new_peers);
    return {
      'type': Gossiper.FIRST_RESPONSE,
      'request_digest': sc.requests,
      'updates': sc.deltas
    };
  };


  secondResponseMessage (requests) {
    return {
      'type': Gossiper.SECOND_RESPONSE,
      'updates': this.scuttle.fetchDeltas(requests)
    };
  };


  setLocalState (k, v) {
    this.my_state.updateLocal(k, v);
  }

  getLocalState (k) {
    return this.my_state.getValue(k);
  }

  peerKeys (peer) {
    return this.peers[peer].getKeys();
  }

  peerValue (peer, k) {
    return this.peers[peer].getValue(k);
  }

  allPeers () {
    let keys = [];
    for (var k in this.peers) {
      keys.push(k)
    }

    return keys;
  }

  livePeers () {
    var keys = [];
    for (var k in this.peers) {
      if (this.peers[k].alive) {
        keys.push(k)
      }
    }
    return keys;
  }

  deadPeers () {
    var keys = [];
    for (var k in this.peers) {
      if (!this.peers[k].alive) {
        keys.push(k)
      }
    }

    return keys;
  }


}