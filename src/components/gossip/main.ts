import {EventEmitter} from 'events';
import {MessageApi} from '../consensus/api/MessageApi';
import messageTypes from '../consensus/constants/MessageTypes';
import {Mokka} from '../consensus/main';
import eventTypes from '../shared/constants/EventTypes';
import {PeerModel} from './models/PeerModel';
import {GossipScuttleService} from './services/GossipScuttleService';
import Timer = NodeJS.Timer;

class GossipController extends EventEmitter {

  public readonly ownState: PeerModel;
  public readonly scuttle: GossipScuttleService;

  private peers: Map<string, PeerModel>;
  private timers: Map<string, Timer>;
  private readonly timeout: number;
  private readonly messageApi: MessageApi;
  private readonly mokka: Mokka;

  constructor(mokka: Mokka, timeout: number) {
    super();

    this.ownState = new PeerModel(mokka.publicKey);
    this.timeout = timeout;

    this.peers = new Map<string, PeerModel>();
    this.timers = new Map<string, Timer>();

    this.peers.set(mokka.publicKey, this.ownState);
    this.scuttle = new GossipScuttleService(this.peers);
    this.messageApi = new MessageApi(mokka);
    this.mokka = mokka;
  }

  public start(): void {

    if (this.timers.has('gossip')) {
      return;
    }

    const gossipTimer = setInterval(() => {
      this.ownState.beatHeart();
      this.gossip();
    }, this.timeout);

    this.timers.set('gossip', gossipTimer);

  }

  public stop(): void {
    this.peers = new Map<string, PeerModel>();

    if (!this.timers.has('gossip'))
      return;

    clearInterval(this.timers.get('gossip'));
    this.timers.delete('gossip');
  }

  public push(hash: string, record: { key: string, value: any, signature: string }) {
    this.ownState.setLocalKey(hash, record, this.ownState.maxVersion + 1);
  }

  public gossip() {

    const livePeer = this.livePeersPublicKeys().length > 0 ? this.chooseRandom(this.livePeersPublicKeys()) : null;

    if (livePeer)
      this.gossipToPeer(livePeer);

    // Possilby gossip to a dead peer
    const prob = this.deadPeersPublicKeys().length / (this.livePeersPublicKeys().length + 1);
    if (Math.random() < prob) {
      const deadPeer = this.chooseRandom(this.deadPeersPublicKeys());
      this.gossipToPeer(deadPeer);
    }

    for (const pubKey of Object.keys(this.peers)) {
      const peer = this.peers.get(pubKey);
      if (peer !== this.ownState)
        peer.isSuspect();
    }
  }

  public chooseRandom(peersPublicKeys: string[]) {
    const i = Math.floor(Math.random() * 1000000) % peersPublicKeys.length;
    const publicKey = peersPublicKeys[i];
    return this.peers.get(publicKey);
  }

  public async gossipToPeer(peer: PeerModel) {
    const data = {
      digest: this.scuttle.digest()
    };

    const reply = await this.messageApi.packet(messageTypes.GOSSIP_REQUEST, data);
    await this.messageApi.message(peer.publicKey, reply);
  }

  public livePeersPublicKeys(): string[] {

    const pubKeys = [];

    for (const pubKey of this.peers.keys()) {
      if (this.peers.get(pubKey).isAlive()) {
        pubKeys.push(pubKey);
      }
    }

    return pubKeys;
  }

  public deadPeersPublicKeys(): string[] {

    const pubKeys = [];

    for (const pubKey of this.peers.keys()) {
      if (!this.peers.get(pubKey).isAlive()) {
        pubKeys.push(pubKey);
      }
    }

    return pubKeys;
  }

  public handleNewPeers(pubKeys: string[]) {
    for (const pubKey of pubKeys) {
      const peer = new PeerModel(pubKey);
      this.peers.set(pubKey, peer);
      this.emit(eventTypes.GOSSIP_NEW_PEER, pubKey);
      this.listenToPeer(peer);
    }
  }

  public listenToPeer(peer: PeerModel) {

    peer.on(eventTypes.GOSSIP_PEER_UPDATE, (k: string, v: any) => {
      this.emit(eventTypes.GOSSIP_PEER_UPDATE, peer.publicKey, k, v);
    });
    peer.on(eventTypes.GOSSIP_PEER_ALIVE, () => {
      this.emit(eventTypes.GOSSIP_PEER_ALIVE, peer.publicKey);
    });
    peer.on(eventTypes.GOSSIP_PEER_FAILED, () => {
      this.emit(eventTypes.GOSSIP_PEER_FAILED, peer.publicKey);
    });
  }

  public getPendings(limit = 0): Array<{ hash: string, log: any }> {

    const data: Map<string, any> = new Map<string, any>();

    for (const pubKey of this.peers.keys()) {
      const peer = this.peers.get(pubKey);
      const pendings = peer.getPendingLogs();

      for (const pending of pendings) {
        data.set(pending.hash, pending.log);
      }
    }

    const uniqData: Array<{ hash: string, log: any }> = [];

    for (const hash of data.keys()) {
      uniqData.push({hash, log: data.get(hash)});
      if (limit > 0 && uniqData.length === limit)
        return uniqData;
    }

    return uniqData;
  }

  public pullPending(hash: string): void {
    for (const peer of this.peers.values()) {
      peer.pullPending(hash);
    }
  }

  public getPending(hash: string): any {
    for (const peer of this.peers.values()) {
      const log = peer.getPending(hash);
      if (log)
        return log;
    }
  }

}

export {GossipController};
