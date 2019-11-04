import crypto from 'crypto';
import secrets = require('secrets.js-grempe');
import {StateModel} from '../../storage/models/StateModel';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import voteTypes from '../constants/VoteTypes';
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

    const lastInfo = this.mokka.getLastLogState();

    if (lastInfo.term >= packet.term || lastInfo.index > packet.last.index) {

      if (lastInfo.term >= packet.term) {
        this.mokka.logger.trace(`[vote] peer ${packet.publicKey} outdated by term`);
      } else {
        this.mokka.logger.trace(`[vote] peer ${packet.publicKey} outdated by history`);
      }

      return [];
    }

    if (lastInfo.index === packet.last.index && lastInfo.hash !== packet.last.hash) {
      this.mokka.logger.trace(`[vote] peer ${packet.publicKey} has wrong history`);
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

    const reply = await this.messageApi.packet(messageTypes.VOTED, packet.publicKey, {
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

    const node = this.mokka.nodes.get(packet.publicKey);

    node.setLastLogState(new StateModel(packet.last.index, packet.last.hash, packet.last.term, packet.last.createdAt));

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

    this.mokka.timer.heartbeat(this.mokka.heartbeat);
    // todo send immediate heartbeat
    for (const node of this.mokka.nodes.values()) {
      const packet = await this.messageApi.packet(messageTypes.ACK, node.publicKey);
      await this.messageApi.message(packet);
    }
  }
}

export {VoteApi};
