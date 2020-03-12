import crypto from 'crypto';
import secrets = require('secrets.js-grempe');
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {VoteModel} from '../models/VoteModel';
import {MessageApi} from './MessageApi';

class VoteApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async vote(packet: PacketModel): Promise<PacketModel[]> {

    if (!packet.data.share) {
      this.mokka.logger.trace(`[vote] peer ${packet.publicKey} hasn't provided a share`);
      return [];
    }

    if (this.mokka.term >= packet.term) {
      return [];
    }

    const sign = crypto.createSign('sha256');
    sign.update(Buffer.from(packet.data.share));

    const signature = sign.sign(this.mokka.rawPrivateKey).toString('hex');

    const vote = new VoteModel(
      packet.publicKey,
      [{
        publicKey: this.mokka.publicKey,
        share: packet.data.share,
        signature,
        voted: true
      }],
      null,
      Date.now()
    );

    this.mokka.setVote(vote);

    const reply = this.messageApi.packet(messageTypes.VOTED, {
      signature
    });
    return [reply];
  }

  public async voted(packet: PacketModel): Promise<void> {

    if (!packet.data.signature) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} hasn't provided the signature`);
      return;
    }

    const localShare = this.mokka.vote.shares.find((share) => share.publicKey === packet.publicKey);

    if (!localShare) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided wrong share`);
      return;
    }

    const verify = crypto.createVerify('sha256');
    verify.update(Buffer.from(localShare.share));
    const rawPublicKey = this.mokka.nodes.get(packet.publicKey).rawPublicKey;
    const isSigned = verify.verify(rawPublicKey, Buffer.from(packet.data.signature, 'hex'));

    if (!isSigned) {
      this.mokka.logger.trace(`[voted] peer ${packet.publicKey} provided wrong signature for share`);
      return;
    }

    if (states.CANDIDATE !== this.mokka.state || localShare.voted) {
      return;
    }

    localShare.voted = true;
    localShare.signature = packet.data.signature;

    const votedAmount = this.mokka.vote.shares.filter((share) => share.voted).length;

    if (!this.mokka.quorum(votedAmount))
      return;

    const validatedShares = this.mokka.vote.shares
      .filter((share) => share.voted)
      .map((share: { share: string }) => share.share);

    const comb = secrets.combine(validatedShares);

    if (comb !== this.mokka.vote.secret) {
      this.mokka.vote = new VoteModel();
      return;
    }

    const votedShares = this.mokka.vote.shares.filter((share) => share.voted);

    let compacted = votedShares
      .sort((share1, share2) => share1.share > share2.share ? -1 : 1)
      .reduce((result: string, item: { share: string, signature: string }) => {
        return `${result}y${item.share}g${item.signature}`;
      }, '');

    compacted = `${compacted}x${this.mokka.term}x${this.mokka.vote.started}`;
    this.mokka.setState(states.LEADER, this.mokka.term, this.mokka.publicKey, compacted, this.mokka.vote.started);

    this.mokka.heartbeatCtrl.setNextBeat(this.mokka.heartbeat);
    for (const node of this.mokka.nodes.values()) {
      const packet = this.messageApi.packet(messageTypes.ACK);
      await this.messageApi.message(packet, node.publicKey);
    }
  }
}

export {VoteApi};
