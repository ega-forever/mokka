import crypto from 'crypto';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import NodeStates from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import * as esss from '../utils/esssUtils';
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

    const vote = new VoteModel(packet.data.nonce);
    this.mokka.setVote(vote);

    this.mokka.setState(NodeStates.FOLLOWER, packet.term, null);

    const startBuildVote = Date.now();

    const xCoef = esss.buildXCoef(this.mokka.term, packet.data.nonce, this.mokka.publicKey, packet.publicKey);
    const signature = esss.sign(this.mokka.privateKey, xCoef);

    this.mokka.logger.trace(`built vote in ${Date.now() - startBuildVote}`);

    return this.messageApi.packet(messageTypes.VOTED, {
      x: signature,
      y: packet.data.y
    });
  }

  public async voted(packet: PacketModel): Promise<null> {

    if (states.CANDIDATE !== this.mokka.state) {
      return null;
    }

    if (!packet.data) {
      return null;
    }

    this.mokka.vote.peerReplies.set(packet.publicKey, packet.data);

    if (!this.mokka.quorum(this.mokka.vote.peerReplies.size)) {
      return null;
    }

    const r = esss.buildSecret(this.mokka.term, this.mokka.vote.nonce, this.mokka.publicKey);
    const secret = esss.join([...this.mokka.vote.peerReplies.values()]);

    if (secret !== r) {
      this.mokka.logger.trace('[voted] one of peers provided wrong signature');
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
      return null;
    }

    const fullSigBuildTime = Date.now();
    const partialSignatures = [...this.mokka.vote.peerReplies.values()].map((i) => i.x);
    const fullSignature = esss.buildMultiSig(partialSignatures);
    this.mokka.logger.trace(`full signature has been built in ${Date.now() - fullSigBuildTime}`);

    const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();
    const indexes = [...this.mokka.vote.peerReplies.keys()].map((publicKey) => sortedPublicKeys.indexOf(publicKey));

    const compacted = `${indexes.join('x')}x${this.mokka.vote.nonce}x${fullSignature}`;
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
      const involvedPublicKeys = splitPoof.slice(0, splitPoof.length - 2)
        .map((i) => sortedPublicKeys[parseInt(i, 10)]);

      const isValid = esss.validateMultiSig(signature, packet.publicKey, involvedPublicKeys, this.mokka.term, nonce);

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
