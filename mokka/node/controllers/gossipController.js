const _ = require('lodash'),
  states = require('../factories/stateFactory'),
  {PeerState} = require('../../../gossip/node-gossip/lib/peer_state'), //todo move
  {Scuttle} = require('../../../gossip/node-gossip/lib/scuttle'),
  EventEmitter = require('events'),
  messageTypes = require('../factories/messageTypesFactory');


class GossipController extends EventEmitter {

  constructor (mokka) {
    super();
    this.mokka = mokka;

    this.peers = {}; //todo init
    this.seeds = [];

    this.my_state = new PeerState(mokka.publicKey);
    this.scuttle = new Scuttle(this.peers, this.my_state);//todo pass peers
  }


  start () {
    this.mokka.time.timers.setInterval('gossip_heart_beat', () => this.my_state.beatHeart(), 1000);
    this.mokka.time.timers.setInterval('gossip', () => this.gossip(), 1000);

    setInterval(()=>{
      console.log('test')
      this.my_state.updateLocal('test','test123');
    }, 5000)


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
      if (Math.random() < (this.seeds.length / Object.keys(this.peers).length))
        this.gossipToPeer(chooseRandom(this.peers));


    // Check health of peers

    for(let pubKey of Object.keys(this.peers)) {
      let peer = this.peers[pubKey];
      if(peer !== this.my_state) {
        peer.isSuspect();
      }
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
      this.peers[pubKey] = new PeerState(pubKey);
      this.emit('new_peer', pubKey);//todo move to state
      let peer = this.peers[pubKey];
      this.listenToPeer(peer);
    }
  };


  listenToPeer (peer) {

    console.log(peer)

    peer.on('update', (k,v)=> { //todo move to state
      process.exit(0)
      this.emit('update', peer.name, k, v);
    });
    peer.on('peer_alive', ()=> { //todo move to state
      this.emit('peer_alive', peer.name);
    });
    peer.on('peer_failed', ()=> { //todo move to state
      this.emit('peer_failed', peer.name);
    });
  };

}


module.exports = GossipController;