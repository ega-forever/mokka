import * as utils from '../../proof/cryptoUtils';
import eventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {VoteModel} from '../models/VoteModel';
import {compressPublicKeySecp256k1} from '../utils/keyPair';
import {buildVote} from '../utils/voteSig';
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
    const vote = new VoteModel(startTime, this.mokka.election.max);
    this.mokka.setState(states.CANDIDATE, this.mokka.term + 1, '');

    for (const publicKeyCombined of this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap.keys()) {
      const publicKeysInvolved = this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap.get(publicKeyCombined).pairs;
      const {nonce: nonceCombined, nonceIsNegated} = utils.buildCombinedNonce(
        this.mokka.term,
        startTime,
        publicKeysInvolved,
        publicKeyCombined
      );

      vote.publicKeyToNonce.set(publicKeyCombined, {
        nonce: nonceCombined,
        nonceIsNegated
      });
    }

    this.mokka.setVote(vote);

    for (const publicKey of [...this.mokka.nodes.keys(), this.mokka.publicKey]) {
      const votePayload = {
        nonce: startTime,
        publicKey,
        term: this.mokka.term
      };

      if (publicKey === this.mokka.publicKey) { // todo should work for all possible nonces
        const selfVote = buildVote(
          votePayload.nonce,
          votePayload.publicKey,
          votePayload.term,
          this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap,
          this.mokka.privateKey,
          this.mokka.publicKey
        );
        for (const multiPublicKey of vote.publicKeyToNonce.keys()) {
          if (!vote.peerReplies.has(multiPublicKey)) {
            vote.peerReplies.set(multiPublicKey, new Map<string, string>());
          }

          if (selfVote.has(multiPublicKey)) {
            vote.peerReplies.get(multiPublicKey).set(publicKey, selfVote.get(multiPublicKey));
          }
        }
        continue;
      }

      const packet = this.messageApi.packet(messageTypes.VOTE, {
        nonce: startTime
      });

      await this.messageApi.message(packet, publicKey);
    }

    await new Promise((res) => setTimeout(res, this.mokka.election.max));

    if (this.mokka.state === states.CANDIDATE) {
      this.mokka.logger.info('change state back to FOLLOWER');
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
    }

  }

}

export {NodeApi};
