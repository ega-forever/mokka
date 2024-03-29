import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import NodeStates from '../constants/NodeStates';
import { Mokka } from '../main';
import { PacketModel } from '../models/PacketModel';
import { VoteModel } from '../models/VoteModel';
import * as utils from '../utils/cryptoUtils';
import { MessageApi } from './MessageApi';
import EventTypes from '../constants/EventTypes';

class VoteApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async vote(packet: PacketModel): Promise<PacketModel> {

    if (!packet.data.nonce ||
      packet.data.nonce > Date.now() ||
      Date.now() - packet.data.nonce > this.mokka.electionTimeout) {
      this.mokka.logger.trace(`[vote] peer ${ packet.publicKey } hasn't provided a correct nonce`);
      return this.messageApi.packet(messageTypes.VOTED);
    }

    if (
      this.mokka.term >= packet.term ||
      (this.mokka.vote && this.mokka.vote.term >= packet.term) ||
      !this.mokka.checkTermNumber(packet.term) ||
      !this.mokka.checkPublicKeyCanBeLeaderNextRound(packet.publicKey)
    ) {
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const wasAckFromLeader = await this.waitForNextAck();

    if (wasAckFromLeader) {
      this.mokka.logger.trace(`[vote] peer ${ packet.publicKey } asked to vote with alive leader`);
      return this.messageApi.packet(messageTypes.VOTED);
    }

    const isCustomRulePassed = await this.mokka.customVoteRule(packet);

    if (!isCustomRulePassed) {
      return this.messageApi.packet(messageTypes.VOTED);
    }
    const publicKeysRootForTerm = utils.buildPublicKeysRootForTerm(
      this.mokka.publicKeysRoot,
      packet.term,
      packet.data.nonce,
      packet.publicKey
    );

    const vote = new VoteModel(packet.data.nonce, packet.term, publicKeysRootForTerm);
    this.mokka.setVote(vote);

    const startBuildVote = Date.now();
    const signature = utils.buildPartialSignature(
      this.mokka.privateKey,
      packet.term,
      packet.data.nonce,
      publicKeysRootForTerm
    );
    this.mokka.logger.trace(`built vote in ${ Date.now() - startBuildVote }`);

    return this.messageApi.packet(messageTypes.VOTED, {
      signature
    });
  }

  public async voted(packet: PacketModel): Promise<null> {

    if (states.CANDIDATE !== this.mokka.state || !packet.data) {
      return null;
    }

    const startPartialSigVerificationTime = Date.now();
    const isValidPartialSignature = utils.partialSignatureVerify(
      packet.data.signature,
      packet.publicKey,
      this.mokka.vote.nonce,
      this.mokka.term,
      this.mokka.vote.publicKeysRootForTerm
    );
    this.mokka.logger.trace(`verified partial signature in ${ Date.now() - startPartialSigVerificationTime }`);

    if (!isValidPartialSignature) {
      this.mokka.logger.trace(`[voted] peer ${ packet.publicKey } provided bad signature`);
      return null;
    }

    if (!this.mokka.vote.repliesPublicKeyToSignatureMap.has(packet.publicKey)) {
      this.mokka.vote.repliesPublicKeyToSignatureMap.set(packet.publicKey, packet.data.signature);
    }

    const isQuorumReached = this.mokka.quorum(this.mokka.vote.repliesPublicKeyToSignatureMap.size);

    if (!isQuorumReached)
      return null;

    const fullSigBuildTime = Date.now();
    const fullSignature = utils.buildSharedSignature(
      Array.from(this.mokka.vote.repliesPublicKeyToSignatureMap.values())
    );
    this.mokka.logger.trace(`full signature has been built in ${ Date.now() - fullSigBuildTime }`);

    const participantPublicKeys = Array.from(this.mokka.vote.repliesPublicKeyToSignatureMap.keys()).sort();
    const sharedPublicKeyXs = Array.from(this.mokka.vote.publicKeyToCombinationMap.keys());

    const sharedPublicKeyX = sharedPublicKeyXs.find((sharedPublicKey) =>
      this.mokka.vote.publicKeyToCombinationMap.get(sharedPublicKey).join('') === participantPublicKeys.join(''));

    const fullSigVerificationTime = Date.now();
    const isValid = utils.verify(
      fullSignature,
      sharedPublicKeyX
    );
    this.mokka.logger.trace(`full signature has been verified in ${ Date.now() - fullSigVerificationTime }`);

    if (!isValid) {
      this.mokka.logger.trace('invalid full signature');
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
      return;
    }

    const compacted = `${ this.mokka.vote.nonce }:${ sharedPublicKeyX }:${ fullSignature }`;
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
      const startProofValidation = Date.now();
      const [proofNonce, proofSharedPublicKeyX, proofSignature] = packet.proof.split(':');

      const publicKeysRootForTerm = utils.buildPublicKeysRootForTerm(
        this.mokka.publicKeysRoot,
        packet.term,
        proofNonce,
        packet.publicKey
      );

      const proofSharedPublicKeyCombination = this.mokka.publicKeysCombinationsInQuorum.find((combination) => {
        return utils.buildSharedPublicKeyX(
          combination,
          packet.term,
          proofNonce,
          publicKeysRootForTerm
        ) === proofSharedPublicKeyX;
      });

      if (!proofSharedPublicKeyCombination) {
        this.mokka.logger.trace(`proof contains unknown public key`);
        return null;
      }

      if (!proofSharedPublicKeyCombination.includes(packet.publicKey)) {
        this.mokka.logger.trace(`proof is used by wrong node`);
        return null;
      }

      const isValid = utils.verify(proofSignature, proofSharedPublicKeyX);

      if (!isValid) {
        this.mokka.logger.trace(`wrong proof supplied`);
        return null;
      }

      this.mokka.setState(
        states.FOLLOWER,
        packet.term,
        packet.publicKey,
        packet.proof,
        parseInt(proofNonce, 10));
      this.mokka.logger.trace(`proof validated in ${ Date.now() - startProofValidation }`);
      return packet;
    }

    return packet;
  }

  private async waitForNextAck(): Promise<boolean> {
    return await new Promise((res) => {

      const timeoutHandler = () => {
        this.mokka.removeListener(EventTypes.ACK, emitHandler);
        res(false);
      };

      const timeoutId = setTimeout(timeoutHandler, this.mokka.heartbeatCtrl.safeHeartbeat());

      const emitHandler = () => {
        clearTimeout(timeoutId);
        res(true);
      };

      this.mokka.once(EventTypes.ACK, emitHandler);
    });
  }

}

export { VoteApi };
