import crypto from 'crypto';
import secrets = require('secrets.js-grempe');
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import {buildVote} from '../utils/voteSig';
import {MessageApi} from './MessageApi';
import * as utils from '../../proof/cryptoUtils';

class VoteApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async vote(packet: PacketModel): Promise<PacketModel[]> {

    console.log('!!', this.mokka.term, packet.term);
    if (!packet.data.nonce) {
      this.mokka.logger.trace(`[vote] peer ${packet.publicKey} hasn't provided a nonce`);
      return [];
    }

    if (this.mokka.term >= packet.term) {
      return [];
    }

    /*    const sign = crypto.createSign('sha256');
        sign.update(Buffer.from(packet.data.share));

        const signature = sign.sign(this.mokka.rawPrivateKey).toString('hex');*/

    const vote = new VoteModel(packet.data.nonce, this.mokka.election.max);
    this.mokka.setVote(vote);

    // todo build sig
    const start = Date.now();
    const voteSigs = buildVote(
      packet.data.nonce,
      packet.publicKey,
      packet.term,
      this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap,
      this.mokka.privateKey,
      this.mokka.publicKey
    );

    console.log(`built vote: ${Date.now() - start}`)

    const reply = this.messageApi.packet(messageTypes.VOTED, {
      combinedKeys: [...voteSigs.keys()],
      signatures: [...voteSigs.values()]
    });
    return [reply];
  }

  public async voted(packet: PacketModel): Promise<void> {

    if (states.CANDIDATE !== this.mokka.state) {
      return;
    }

    if (!packet.data.signatures) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} hasn't provided signatures`);
      return;
    }

    const isAnyUnknownKey = packet.data.combinedKeys.find((key) =>
      ![...this.mokka.multiPublicKeyToPublicKeyHashAndPairsMap.keys()].includes(key)
    );

    if (isAnyUnknownKey) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided unknown combinedPublicKey`);
      return;
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
        console.log('state 2');
        this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided bad signature`);
        return;
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

    console.log(multiKeyInQuorum);
    if (!multiKeyInQuorum)
      return;

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

    this.mokka.heartbeatCtrl.setNextBeat(this.mokka.heartbeat);
    for (const node of this.mokka.nodes.values()) {
      const packet = this.messageApi.packet(messageTypes.ACK);
      await this.messageApi.message(packet, node.publicKey);
    }
  }
}

export {VoteApi};
