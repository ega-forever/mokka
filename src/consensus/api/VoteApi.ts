import crypto from 'crypto';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import NodeStates from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import * as cryptoUtils from '../utils/cryptoUtils';
import {MessageApi} from './MessageApi';

class VoteApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async vote(packet: PacketModel): Promise<PacketModel> {

    if (this.mokka.term >= packet.term) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    if (Date.now() - packet.data.nonce > this.mokka.proofExpiration) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const isCustomRulePassed = await this.mokka.customVoteRule(packet);

    if (!isCustomRulePassed) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const secret = cryptoUtils.buildSecret(packet.term, this.mokka.majority(), packet.data.nonce, packet.publicKey);
    const vote = new VoteModel(packet.data.nonce, secret);
    this.mokka.setVote(vote);

    this.mokka.setState(NodeStates.FOLLOWER, packet.term, null);

    const startBuildVote = Date.now();

    const signature = cryptoUtils.sign(this.mokka.privateKey, secret);
    this.mokka.logger.trace(`built vote in ${Date.now() - startBuildVote}`);

    return this.messageApi.packet(messageTypes.VOTED, {signature});
  }

  public async voted(packet: PacketModel): Promise<null> {

    if (states.CANDIDATE !== this.mokka.state) {
      return null;
    }

    if (!packet.data) {
      return null;
    }

    this.mokka.vote.peerReplies.set(packet.publicKey, packet.data.signature);

    if (!this.mokka.quorum(this.mokka.vote.peerReplies.size)) {
      return null;
    }

    const isSignatureValid = cryptoUtils.partialValidateMultiSig(
      this.mokka.vote.secret,
      packet.publicKey,
      packet.data.signature
    );

    if (!isSignatureValid) {
      this.mokka.logger.trace('[voted] one of peers provided wrong signature');
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
      return null;
    }

    const fullSigBuildTime = Date.now();

    const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();

    const usedPublicKeys = [...this.mokka.vote.peerReplies.keys()];
    const usedPublicKeysIndexes = sortedPublicKeys
      .map((publicKey, index) => [publicKey, index])
      .filter((item) => usedPublicKeys.includes(item[0] as string))
      .map((item) => item[1]) as number[];

    const fullSignature = cryptoUtils.buildMultiSignature([...this.mokka.vote.peerReplies.values()]);
    this.mokka.logger.trace(`full signature has been built in ${Date.now() - fullSigBuildTime}`);

    const compacted = `${usedPublicKeysIndexes.join('x')}x${this.mokka.vote.nonce}x${fullSignature}`;
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
      const splitPoof = packet.proof.split('x');
      const nonce = parseInt(splitPoof[splitPoof.length - 2], 10);
      const signature = splitPoof[splitPoof.length - 1];
      const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();
      const involvedPublicKeysIndexes = splitPoof.slice(0, splitPoof.length - 2).map((s) => parseInt(s, 10));
      const notInvolvedPublicKeys = new Array(sortedPublicKeys.length)
        .fill(0)
        .map((_, i) => i)
        .filter((i) => !involvedPublicKeysIndexes.includes(i))
        .map((i) => sortedPublicKeys[i]);
      const secret = cryptoUtils.buildSecret(
        packet.term,
        this.mokka.majority(),
        nonce,
        packet.publicKey
      );

      const isValid = cryptoUtils.validateMultiSig(
        signature,
        secret,
        sortedPublicKeys,
        notInvolvedPublicKeys
      );

      if (!isValid) {
        this.mokka.logger.trace(`wrong proof supplied`);
        return null;
      }

      this.mokka.setState(
        states.FOLLOWER,
        packet.term,
        packet.publicKey,
        packet.proof,
        nonce);
      return packet;
    }

    return packet;
  }

}

export {VoteApi};
