import eventTypes from '../constants/EventTypes';
import EventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import * as esss from '../utils/esssUtils';
import {MessageApi} from './MessageApi';

class NodeApi {

  private readonly mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public join(multiaddr: string): NodeModel {

    const publicKey = multiaddr.match(/\w+$/).toString();

    if (this.mokka.publicKey === publicKey)
      return;

    const node = new NodeModel(null, multiaddr, states.STOPPED);

    node.write = this.mokka.write.bind(this.mokka);
    node.once('end', () => this.leave(node.publicKey));

    this.mokka.nodes.set(publicKey, node);
    this.mokka.emit(eventTypes.NODE_JOIN, node);
    return node;
  }

  public leave(publicKey: string): void {

    const node = this.mokka.nodes.get(publicKey);
    this.mokka.nodes.delete(publicKey);

    this.mokka.emit(eventTypes.NODE_LEAVE, node);
  }

  public async promote(): Promise<void> {

    if (this.mokka.state === states.CANDIDATE) {
      return;
    }

    const nonce = Date.now();
    const vote = new VoteModel(nonce);
    this.mokka.setState(states.CANDIDATE, this.mokka.term + 1, '');

    const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();

    const sh = esss.split(this.mokka.publicKey, this.mokka.term, nonce, this.mokka.majority(), sortedPublicKeys);

    for (let i = 0; i < sh.length; i++) {
      const share = sh[i];
      const publicKey = sortedPublicKeys[i];

      if (publicKey === this.mokka.publicKey) {
        const signature = esss.sign(this.mokka.privateKey, share[0]);
        vote.peerReplies.set(publicKey, {
          x: signature,
          y: share[1]
        });
        continue;
      }

      const packet = this.messageApi.packet(messageTypes.VOTE, {
        xCoef: share[0],
        y: share[1]
      });

      await this.messageApi.message(packet, publicKey);
    }

    this.mokka.setVote(vote);

    await new Promise((res) => {

      const timeoutHandler = () => {
        this.mokka.removeListener(EventTypes.STATE, emitHandler);
        res();
      };

      const timeoutId = setTimeout(timeoutHandler, this.mokka.electionTimeout);

      const emitHandler = () => {
        clearTimeout(timeoutId);
        res();
      };

      this.mokka.once(EventTypes.STATE, emitHandler);
    });

    if (this.mokka.state === states.CANDIDATE) {
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
    }
  }

  public async pingFromLeader(packet: PacketModel | null): Promise<PacketModel | null> {
    if (packet && packet.state === states.LEADER) {
      this.mokka.logger.trace(`accepted ack`);
      this.mokka.heartbeatCtrl.setNextBeat(this.mokka.heartbeatCtrl.timeout());
    }
    return null;
  }

}

export {NodeApi};
