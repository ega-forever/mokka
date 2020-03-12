import crypto from 'crypto';
import secrets = require('secrets.js-grempe');
import eventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {VoteModel} from '../models/VoteModel';
import {compressPublicKeySecp256k1} from '../utils/keyPair';
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

    const shortPubKey = publicKey.length === 66 ? publicKey : compressPublicKeySecp256k1(publicKey);

    if (this.mokka.publicKey === shortPubKey)
      return;

    const node = new NodeModel(null, multiaddr, states.CHILD);

    node.write = this.mokka.write.bind(this.mokka);
    node.once('end', () => this.leave(node.publicKey));

    this.mokka.nodes.set(shortPubKey, node);
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

    const startTime = Date.now();
    const token = `${this.mokka.term + 1}x${startTime}`;
    const secret = secrets.str2hex(token);

    const shares: string[] = secrets.share(secret, this.mokka.nodes.size + 1, this.mokka.majority());
    const peerPubKeys = Array.from(this.mokka.nodes.keys());

    const voteData = shares
      .sort()
      .map((share: string, index: number) => {

        if (index === this.mokka.nodes.size) {

          const sign = crypto.createSign('sha256');
          sign.update(Buffer.from(share));

          const signature = sign.sign(this.mokka.rawPrivateKey).toString('hex');
          return {
            publicKey: this.mokka.publicKey,
            share,
            signature,
            voted: true
          };
        }

        return {
          publicKey: peerPubKeys[index],
          share,
          signature: null,
          voted: false
        };
      });

    this.mokka.setVote(
      new VoteModel(this.mokka.publicKey, voteData, secret, startTime)
    );
    this.mokka.setState(states.CANDIDATE, this.mokka.term + 1, '');

    for (const share of voteData.slice(0, -1)) {
      const packet = this.messageApi.packet(messageTypes.VOTE, {
        share: share.share
      });

      await this.messageApi.message(packet, share.publicKey);
    }

    await new Promise((res) => setTimeout(res, this.mokka.election.max));

    if (this.mokka.state === states.CANDIDATE) {
      this.mokka.logger.info('change state back to FOLLOWER');
      this.mokka.setState(states.FOLLOWER, this.mokka.term - 1, '');
    }

  }

}

export {NodeApi};
