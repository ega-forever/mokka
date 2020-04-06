import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import NodeStates from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import * as utils from '../utils/cryptoUtils';
import {buildVote} from '../utils/voteSig';
import {MessageApi} from './MessageApi';

class VoteApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async vote(packet: PacketModel): Promise<PacketModel> {

    if (!packet.data.nonce) {
      this.mokka.logger.trace(`[vote] peer ${packet.publicKey} hasn't provided a nonce`);
      return this.messageApi.packet(messageTypes.VOTED);
    }

    if (this.mokka.state === NodeStates.CANDIDATE || this.mokka.term >= packet.term) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const isCustomRulePassed = await this.mokka.customVoteRule(packet);

    if (!isCustomRulePassed) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const vote = new VoteModel(packet.data.nonce);
    this.mokka.setVote(vote);

    this.mokka.setState(this.mokka.state, this.mokka.term, this.mokka.leaderPublicKey);

    const voteSigs = buildVote(
      packet.data.nonce,
      packet.publicKey,
      packet.term,
      this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap,
      this.mokka.privateKey,
      this.mokka.publicKey
    );

    return this.messageApi.packet(messageTypes.VOTED, {
      combinedKeys: [...voteSigs.keys()],
      signatures: [...voteSigs.values()]
    });
  }

  public async voted(packet: PacketModel): Promise<null> {

    if (states.CANDIDATE !== this.mokka.state) {
      return null;
    }

    // todo

    if (!packet.data) {
      if (this.mokka.vote.peerReplies.has(null)) {
        this.mokka.vote.peerReplies.get(null).set(packet.publicKey, null);
        if (
          this.mokka.quorum(this.mokka.vote.peerReplies.get(null).size) ||
          ((this.mokka.nodes.size + 1) % 2 === 0 &&
            (this.mokka.nodes.size + 1) / 2 === this.mokka.vote.peerReplies.get(null).size
          )
        ) {
          this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
        }
      }

      return null;
    }

    const isAnyUnknownKey = packet.data.combinedKeys.find((key) =>
      ![...this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap.keys()].includes(key)
    );

    if (isAnyUnknownKey) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided unknown combinedPublicKey`);
      return null;
    }

    for (const multiPublicKey of this.mokka.vote.publicKeyToNonce.keys()) {
      const nonceData = this.mokka.vote.publicKeyToNonce.get(multiPublicKey);
      const publicKeyData = this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap.get(multiPublicKey);

      if (!packet.data.combinedKeys.includes(multiPublicKey)) {
        continue;
      }

      const signature = packet.data.signatures[packet.data.combinedKeys.indexOf(multiPublicKey)];

      const isValid = utils.partialSigVerify( // todo use current share
        this.mokka.term,
        this.mokka.vote.nonce,
        multiPublicKey,
        publicKeyData.hash,
        signature,
        nonceData.nonce,
        publicKeyData.pairs.indexOf(packet.publicKey),
        packet.publicKey,
        nonceData.nonceIsNegated
      );

      if (!isValid) { // todo should be treated as error
        this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided bad signature`);
        return null;
      }

      if (!this.mokka.vote.peerReplies.has(multiPublicKey)) {
        this.mokka.vote.peerReplies.set(multiPublicKey, new Map<string, string>());
      }

      this.mokka.vote.peerReplies.get(multiPublicKey).set(packet.publicKey, signature);
    }

    const multiKeyInQuorum = Array.from(this.mokka.vote.peerReplies.keys())
      .find((multiKey) =>
        this.mokka.vote.peerReplies.has(multiKey) && this.mokka.quorum(this.mokka.vote.peerReplies.get(multiKey).size)
      );

    if (!multiKeyInQuorum)
      return null;

    const nonceCombined = this.mokka.vote.publicKeyToNonce.get(multiKeyInQuorum).nonce;

    const fullSignature = utils.partialSigCombine(
      nonceCombined,
      Array.from(this.mokka.vote.peerReplies.get(multiKeyInQuorum).values())
    );
    const isValid = utils.verify(this.mokka.term, this.mokka.vote.nonce, multiKeyInQuorum, fullSignature);

    if (!isValid) {
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
      return;
    }

    const compacted = `${this.mokka.vote.nonce}:${multiKeyInQuorum}:${fullSignature}`;
    this.mokka.setState(states.LEADER, this.mokka.term, this.mokka.publicKey, compacted, this.mokka.vote.nonce);
    return null;
  }

  public async validateAndApplyLeader(packet: PacketModel): Promise<PacketModel | null> {

    if (
      packet.term < this.mokka.term ||
      !packet.proof || (
      this.mokka.proof &&
      this.mokka.proof === packet.proof &&
      this.mokka.getProofMintedTime() + this.mokka.proofExpiration < Date.now())
    ) {
      return null;
    }

    if (this.mokka.proof !== packet.proof) {

      const splitPoof = packet.proof.split(':');
      const isValid = utils.verify(packet.term, parseInt(splitPoof[0], 10), splitPoof[1], splitPoof[2]);

      if (!isValid) {
        return null;
      }

      this.mokka.setState(
        states.FOLLOWER,
        packet.term,
        packet.publicKey,
        packet.proof,
        parseInt(splitPoof[0], 10));
      return packet;
    }

    return packet;
  }

}

export {VoteApi};
