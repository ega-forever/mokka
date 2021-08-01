import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import NodeStates from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import * as utils from '../utils/cryptoUtils';
import {buildVote} from '../utils/voteSig';
import {MessageApi} from './MessageApi';
import {getCombinations} from "../utils/utils";

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
    const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();
    const sharedPublicKeyFull = utils.buildSharedPublicKeyX(
      sortedPublicKeys,
      packet.term,
      packet.data.nonce,
      packet.publicKey
    );

    const vote = new VoteModel(packet.data.nonce, sharedPublicKeyFull);
    this.mokka.setVote(vote);

    this.mokka.setState(NodeStates.FOLLOWER, packet.term, null);

    const startBuildVote = Date.now();
    const signature = buildVote(
      packet.data.nonce,
      packet.term,
      sharedPublicKeyFull,
      this.mokka.privateKey
    );
    this.mokka.logger.trace(`built vote in ${Date.now() - startBuildVote}`);

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
      this.mokka.vote.sharedPublicKey
    );
    this.mokka.logger.trace(`verified partial signature in ${Date.now() - startPartialSigVerificationTime}`);

    if (!isValidPartialSignature) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided bad signature`);
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
    this.mokka.logger.trace(`full signature has been built in ${Date.now() - fullSigBuildTime}`);

    const participantPublicKeys = Array.from(this.mokka.vote.repliesPublicKeyToSignatureMap.keys()).sort();
    const sharedPublicKeyXs = Array.from(this.mokka.vote.publicKeyToCombinationMap.keys());

    const sharedPublicKeyX = sharedPublicKeyXs.find(sharedPublicKey =>
      this.mokka.vote.publicKeyToCombinationMap.get(sharedPublicKey).join('') === participantPublicKeys.join(''));

    const fullSigVerificationTime = Date.now();
    const isValid = utils.verify(
      fullSignature,
      sharedPublicKeyX
    );
    this.mokka.logger.trace(`full signature has been verified in ${Date.now() - fullSigVerificationTime}`);

    if (!isValid) {
      this.mokka.logger.trace('invalid full signature');
      this.mokka.setState(states.FOLLOWER, this.mokka.term, null);
      return;
    }

    const compacted = `${this.mokka.vote.nonce}:${sharedPublicKeyX}:${fullSignature}`;
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
      const splitPoof = packet.proof.split(':');

      const sortedPublicKeys = [...this.mokka.nodes.keys(), this.mokka.publicKey].sort();

      const sharedPublicKeyFull = utils.buildSharedPublicKeyX(
        sortedPublicKeys,
        this.mokka.term,
        splitPoof[0],
        packet.publicKey
      );

      const combinations = getCombinations(sortedPublicKeys, this.mokka.majority()); // todo move calculation on peer add/remove
      const publicKeyToCombinationMap = new Map<string, string[]>();


      for (const combination of combinations) {
        const sharedPublicKeyPartial = utils.buildSharedPublicKeyX(
          combination,
          packet.term,
          splitPoof[0],
          sharedPublicKeyFull
        );
        publicKeyToCombinationMap.set(sharedPublicKeyPartial, combination);
      }

      if (!publicKeyToCombinationMap.has(splitPoof[1])) {
        this.mokka.logger.trace(`proof contains unknown public key`);
        return null;
      }

      const isValid = utils.verify(splitPoof[2], splitPoof[1]);

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
      this.mokka.logger.trace(`proof validated in ${Date.now() - startProofValidation}`)
      return packet;
    }

    return packet;
  }

}

export {VoteApi};
