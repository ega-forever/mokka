import {EventEmitter} from 'events';
import flattenDeep from 'lodash/flattenDeep';
import take from 'lodash/take';
import toPairs from 'lodash/toPairs';
import uniqBy from 'lodash/uniqBy';
import values from 'lodash/values';
import {MessageApi} from '../consensus/api/MessageApi';
import messageTypes from '../consensus/constants/MessageTypes';
import {Mokka} from '../consensus/main';
import Timer = NodeJS.Timer;
import eventTypes from '../shared/constants/EventTypes';
import {IIndexObject} from '../shared/types/IIndexObjectType';
import {PeerModel} from './models/PeerModel';
import {GossipScuttleService} from './services/GossipScuttleService';

class GossipController extends EventEmitter {
  public ownState: PeerModel;
  public scuttle: GossipScuttleService;

  private peers: IIndexObject<PeerModel> = {};
  private timers: IIndexObject<Timer> = {};
  private timeout: number;
  private messageApi: MessageApi;
  private mokka: Mokka;

  constructor(mokka: Mokka, timeout: number) {
    super();

    this.ownState = new PeerModel(mokka.publicKey);
    this.timeout = timeout;

    this.peers[mokka.publicKey] = this.ownState;
    this.scuttle = new GossipScuttleService(this.peers);
    this.messageApi = new MessageApi(mokka);
    this.mokka = mokka;
  }

  public start(): void {

    if (!this.timers.gossip)
      this.timers.gossip = setInterval(() => {
        this.ownState.beatHeart();
        this.gossip();
      }, this.timeout);
  }

  public stop(): void {
    this.peers = {};

    if (!this.timers.gossip)
      return;

    clearInterval(this.timers.gossip);
    delete this.timers.gossip;
  }

  public push(hash: string, record: {key: string, value: any, signature: string}) {
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
    return toPairs(this.peers)
      .filter((pair) => pair[1].isAlive())
      .map((pair) => pair[0]);
  }

  public deadPeersPublicKeys(): string[] {
    return toPairs(this.peers)
      .filter((pair) => !pair[1].isAlive())
      .map((pair) => pair[0]);
  }

  public handleNewPeers(pubKeys: string[]) {
    for (const pubKey of pubKeys) {
      this.peers[pubKey] = new PeerModel(pubKey);
      this.emit(eventTypes.GOSSIP_NEW_PEER, pubKey);
      const peer = this.peers[pubKey];
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

    let data: any = values(this.peers)
      .map((peer: PeerModel) => peer.getPendingLogs());

    data = flattenDeep(data);
    data = uniqBy(data, 'hash');
    return take(data, limit);
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
