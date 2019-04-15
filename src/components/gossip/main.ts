import {EventEmitter} from 'events';
import * as _ from 'lodash';
import Timer = NodeJS.Timer;
import {MessageApi} from '../consensus/api/MessageApi';
import messageTypes from '../consensus/constants/MessageTypes';
import {Mokka} from '../consensus/main';
import {GossipOptions} from './models/GossipOptions';
import {PeerModel} from './models/PeerModel';
import {GossipScuttleService} from './services/GossipScuttleService';
import {IIndexObject} from './types/IIndexObjectType';

class GossipController extends EventEmitter {
  public ownState: PeerModel;
  public scuttle: GossipScuttleService;

  private peers: IIndexObject<PeerModel> = {};
  private timers: IIndexObject<Timer> = {};
  private options: GossipOptions;
  private messageApi: MessageApi;
  private mokka: Mokka;

  constructor(mokka: Mokka, options: GossipOptions) {
    super();

    this.ownState = new PeerModel(mokka.publicKey);
    this.options = options;

    this.peers[mokka.publicKey] = this.ownState;
    this.scuttle = new GossipScuttleService(this.peers);
    this.messageApi = new MessageApi(mokka);
    this.mokka = mokka;
  }

  public start(): void {

    if (!this.timers.gossip_heart_beat)
      this.timers.gossip_heart_beat = setInterval(() => this.ownState.beatHeart(), this.options.heartbeat);

    if (!this.timers.gossip)
      this.timers.gossip = setInterval(() => this.gossip(), this.options.timeout);
  }

  public stop(): void {
    this.peers = {};
    for (const timerKey of Object.keys(this.timers)) {
      clearInterval(this.timers[timerKey]);
      delete this.timers[timerKey];
    }
  }

  public push(hash: string, record: any) {
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
      const peer = this.peers[pubKey];
      if (peer !== this.ownState)
        peer.isSuspect();
    }
  }

  public chooseRandom(peersPublicKeys: string[]) {
    const i = Math.floor(Math.random() * 1000000) % peersPublicKeys.length;
    const publicKey = peersPublicKeys[i];
    return this.peers[publicKey];
  }

  public async gossipToPeer(peer: PeerModel) {
    const data = {
      digest: this.scuttle.digest()
    };

    const reply = await this.messageApi.packet(messageTypes.GOSSIP_REQUEST, data);
    await this.messageApi.message(peer.publicKey, reply);
  }

  public livePeersPublicKeys(): string[] {
    return _.chain(this.peers)
      .toPairs()
      .filter((pair) => pair[1].isAlive())
      .map((pair) => pair[0])
      .value();
  }

  public deadPeersPublicKeys(): string[] {
    return _.chain(this.peers)
      .toPairs()
      .filter((pair) => !pair[1].isAlive())
      .map((pair) => pair[0])
      .value();
  }

  public handleNewPeers(pubKeys: string[]) {
    for (const pubKey of pubKeys) {
      this.peers[pubKey] = new PeerModel(pubKey);
      this.emit('new_peer', pubKey);
      const peer = this.peers[pubKey];
      this.listenToPeer(peer);
    }
  }

  public listenToPeer(peer: PeerModel) {

    peer.on('update', (k: string, v: any) => {
      this.emit('update', peer.publicKey, k, v);
    });
    peer.on('peer_alive', () => {
      this.emit('peer_alive', peer.publicKey);
    });
    peer.on('peer_failed', () => {
      this.emit('peer_failed', peer.publicKey);
    });
  }

  public getPendings(limit = 0): Array<{ hash: string, log: any }> {
    // @ts-ignore
    return _.chain(this.peers)
      .values()
      .map((peer: PeerModel) => peer.getPendingLogs())
      .flattenDeep()
      .uniqBy('hash')
      .take(limit)
      .value();
  }

  public pullPending(hash: string): void {
    for (const peer of Object.values(this.peers))
      peer.pullPending(hash);
  }

  public getPending(hash: string): any {
    for (const peer of Object.values(this.peers)) {
      const log = peer.getPending(hash);
      if (log)
        return log;
    }
  }

}

export {GossipController};
