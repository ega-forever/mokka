import crypto from 'crypto';
import eventTypes from '../constants/EventTypes';
import EventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import * as utils from '../utils/cryptoUtils';
import {getCombinations} from '../utils/utils';
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
    this.mokka.setState(states.CANDIDATE, this.mokka.term + 1, '');


    const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();
    const sharedPublicKeyFull = utils.buildSharedPublicKeyX(sortedPublicKeys, this.mokka.term, nonce, this.mokka.publicKey);
    const vote = new VoteModel(nonce, sharedPublicKeyFull);

    const combinations = getCombinations(sortedPublicKeys, this.mokka.majority()); // todo move calculation on peer add/remove

    for (const combination of combinations) {

      if (!combination.includes(this.mokka.publicKey)) {
        continue;
      }

      const sharedPublicKeyPartial = utils.buildSharedPublicKeyX(combination, this.mokka.term, nonce, sharedPublicKeyFull);
      vote.publicKeyToCombinationMap.set(sharedPublicKeyPartial, combination);
    }

    this.mokka.setVote(vote);

    const votePayload = {
      nonce,
      publicKey: this.mokka.publicKey,
      term: this.mokka.term
    };

    const selfVote = buildVote(
        votePayload.nonce,
        votePayload.term,
        sharedPublicKeyFull,
        this.mokka.privateKey
    );

    vote.repliesPublicKeyToSignatureMap.set(this.mokka.publicKey, selfVote)

    const packet = this.messageApi.packet(messageTypes.VOTE, {
      nonce
    });

    await Promise.all(
        [...this.mokka.nodes.values()].map((node) =>
            this.messageApi.message(packet, node.publicKey)
        ));

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
