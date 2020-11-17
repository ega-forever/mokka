import crypto from 'crypto';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import NodeStates from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import * as utils from '../utils/cryptoUtils';
import {getCombinations} from '../utils/utils';
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

    if (this.mokka.term >= packet.term) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const isCustomRulePassed = await this.mokka.customVoteRule(packet);

    if (!isCustomRulePassed) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const vote = new VoteModel(packet.data.nonce);
    this.mokka.setVote(vote);

    this.mokka.setState(NodeStates.FOLLOWER, packet.term, null);

    const startBuildVote = Date.now();
    const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();
    const combinations = getCombinations(sortedPublicKeys, this.mokka.majority());
    const voteSharedPublicKeyXSignaturesMap = buildVote(
      packet.data.nonce,
      packet.term,
      packet.publicKey,
      combinations,
      this.mokka.privateKey,
      this.mokka.publicKey
    );
    this.mokka.logger.trace(`built vote in ${Date.now() - startBuildVote}`);

    return this.messageApi.packet(messageTypes.VOTED, {
      sharedPublicKeyXs: [...voteSharedPublicKeyXSignaturesMap.keys()],
      signatures: [...voteSharedPublicKeyXSignaturesMap.values()]
    });
  }

  public async voted(packet: PacketModel): Promise<null> {

    if (states.CANDIDATE !== this.mokka.state) {
      return null;
    }

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

    const isAnyUnknownKey = packet.data.sharedPublicKeyXs.find((key) =>
      ![...this.mokka.vote.publicKeyToNonce.keys()].includes(key)
    );

    if (isAnyUnknownKey) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided unknown combinedPublicKey`);
      return null;
    }

    for (const multiPublicKey of this.mokka.vote.publicKeyToNonce.keys()) {

      if (!packet.data.sharedPublicKeyXs.includes(multiPublicKey)) {
        continue;
      }

      const nonceData = this.mokka.vote.publicKeyToNonce.get(multiPublicKey);
      const partialSignature = packet.data.signatures[packet.data.sharedPublicKeyXs.indexOf(multiPublicKey)];
      const aIndex = nonceData.combination.indexOf(packet.publicKey);
      const a = nonceData.as[aIndex];

      const startPartialSigVerificationTime = Date.now();
      const isValid = utils.partialSignatureVerify(
        partialSignature,
        packet.publicKey,
        a,
        nonceData.e
      );
      this.mokka.logger.trace(`verified partial signature in ${Date.now() - startPartialSigVerificationTime}`);

      if (!isValid) {
        this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided bad signature`);
        return null;
      }

      if (!this.mokka.vote.peerReplies.has(multiPublicKey)) {
        this.mokka.vote.peerReplies.set(multiPublicKey, new Map<string, string>());
      }

      this.mokka.vote.peerReplies.get(multiPublicKey).set(packet.publicKey, partialSignature);
    }

    const multiKeyInQuorum = Array.from(this.mokka.vote.peerReplies.keys())
      .find((multiKey) =>
        this.mokka.vote.peerReplies.has(multiKey) && this.mokka.quorum(this.mokka.vote.peerReplies.get(multiKey).size)
      );

    if (!multiKeyInQuorum)
      return null;

    const nonceData = this.mokka.vote.publicKeyToNonce.get(multiKeyInQuorum);

    const fullSigBuildTime = Date.now();
    const fullSignature = utils.buildSharedSignature(
      Array.from(this.mokka.vote.peerReplies.get(multiKeyInQuorum).values())
    );
    this.mokka.logger.trace(`full signature has been built in ${Date.now() - fullSigBuildTime}`);

    const fullSigVerificationTime = Date.now();
    const isValid = utils.verify(
      fullSignature,
      multiKeyInQuorum,
      nonceData.e
    );
    this.mokka.logger.trace(`full signature has been verified in ${Date.now() - fullSigVerificationTime}`);

    if (!isValid) {
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
      return;
    }

    const compacted = `${this.mokka.vote.nonce}:${multiKeyInQuorum}:${fullSignature}`;
    this.mokka.setState(states.LEADER, this.mokka.term, this.mokka.publicKey, compacted, this.mokka.vote.nonce);
    return null;
  }

  public async validateAndApplyLeader(packet: PacketModel): Promise<PacketModel | null> {

    if (packet.term < this.mokka.term || !packet.proof) {
      this.mokka.logger.trace('no proof supplied or term is outdated');
      return null;
    }

    if (this.mokka.proof &&
      this.mokka.proof === packet.proof &&
      this.mokka.getProofMintedTime() + this.mokka.proofExpiration < Date.now()) {
      this.mokka.logger.trace('proof expired');
      return null;
    }

    if (this.mokka.proof !== packet.proof) {
      const splitPoof = packet.proof.split(':');
      const mHash = crypto.createHash('sha256')
        .update(`${splitPoof[0]}:${packet.term}`)
        .digest('hex');
      const e = utils.buildE(splitPoof[1], mHash);

      const isValid = utils.verify(splitPoof[2], splitPoof[1], e);

      if (!isValid) {
        this.mokka.logger.trace(`wrong proof supplied`);
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
