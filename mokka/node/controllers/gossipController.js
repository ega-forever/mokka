const _ = require('lodash'),
  PeerState = require('../models/peerStateModel'), //todo move
  GossipScuttleService = require('../services/gossipScuttleService'),
  EventEmitter = require('events'),
  messageTypes = require('../factories/messageTypesFactory');


class GossipController extends EventEmitter {

  constructor (mokka) {
    super();
    this.mokka = mokka;

    this.peers = {}; //todo init
    this.myState = new PeerState(mokka.publicKey, mokka);

    this.peers[this.myState.pubKey] = this.myState; //todo validate
    this.scuttle = new GossipScuttleService(this.peers);//todo pass peers
  }


  start () {
    this.mokka.time.timers.setInterval('gossip_heart_beat', () => this.myState.beatHeart(), 1000);
    this.mokka.time.timers.setInterval('gossip', () => this.gossip(), 1000);
  }


  async push (record) {
    let isCommitted = await this.mokka.log.checkPendingCommitted(record);

    if(isCommitted)
      return;

    await this.myState.addToDb(record);
  }

  gossip () {

    const livePeer = this.livePeers().length > 0 ? this.chooseRandom(this.livePeers()) : null;

    if (livePeer)
      this.gossipToPeer(livePeer);

    // Possilby gossip to a dead peer
    let prob = this.deadPeers().length / (this.livePeers().length + 1);
    if (Math.random() < prob) {
      let deadPeer = this.chooseRandom(this.deadPeers());
      this.gossipToPeer(deadPeer);
    }

    for (let pubKey of Object.keys(this.peers)) {
      let peer = this.peers[pubKey];
      if (peer !== this.myState)
        peer.isSuspect();
    }
  }


  chooseRandom (peers) {
    let i = Math.floor(Math.random() * 1000000) % peers.length;
    return peers[i];
  }

  async gossipToPeer (peer) { //todo refactor
    let data = {
      digest: this.scuttle.digest()
    };

    const reply = await this.mokka.actions.message.packet(messageTypes.GOSSIP_REQUEST, data);
    this.mokka.actions.message.message(peer, reply);
  }

  livePeers () {
    return _.chain(this.peers)
      .toPairs()
      .filter(pair => pair[1].alive)
      .map(pair => pair[0])
      .value();
  }

  deadPeers () {
    return _.chain(this.peers)
      .toPairs()
      .filter(pair => !pair[1].alive)
      .map(pair => pair[0])
      .value();
  }

  handleNewPeers (pubKeys) {
    for (let pubKey of pubKeys) {
      this.peers[pubKey] = new PeerState(pubKey, this.mokka);
      this.emit('new_peer', pubKey);//todo move to state
      let peer = this.peers[pubKey];
      this.listenToPeer(peer);
    }
  }

  listenToPeer (peer) {

    peer.on('update', (k, v) => { //todo move to state
      this.emit('update', peer.pubKey, k, v);
    });
    peer.on('peer_alive', () => { //todo move to state
      this.emit('peer_alive', peer.pubKey);
    });
    peer.on('peer_failed', () => { //todo move to state
      this.emit('peer_failed', peer.pubKey);
    });
  }

}


module.exports = GossipController;
