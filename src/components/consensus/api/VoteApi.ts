import secrets = require('secrets.js-grempe');
import nacl = require('tweetnacl');
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

  public async vote(packet: PacketModel): Promise<PacketModel> {

    if (!packet.data.share) {
      return await this.messageApi.packet(messageTypes.VOTED, packet.publicKey, {
        granted: false,
        reason: voteTypes.NO_SHARE,
        signature: null
      });
    }

   //  const lastInfo = await this.mokka.getDb().getState().getInfo(this.mokka.publicKey);
    const lastInfo = this.mokka.getLastLogState();

    if (lastInfo.term >= packet.term || lastInfo.index > packet.last.index) {
      return await this.messageApi.packet(messageTypes.VOTED, packet.publicKey, {
        reason: lastInfo.term >= packet.term ?
          voteTypes.CANDIDATE_OUTDATED_BY_TERM : voteTypes.CANDIDATE_OUTDATED_BY_HISTORY,
        signature: null
      });
    }

    if (lastInfo.index === packet.last.index && lastInfo.hash !== packet.last.hash) {

      return await this.messageApi.packet(messageTypes.VOTED, packet.publicKey, {
        reason: voteTypes.CANDIDATE_HAS_WRONG_HISTORY,
        signature: null
      });
    }

    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(packet.data.share),
        Buffer.from(this.mokka.privateKey, 'hex')
      )
    ).toString('hex');

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

    return await this.messageApi.packet(messageTypes.VOTED, packet.publicKey, {
      signature
    });
  }

  public async voted(packet: PacketModel): Promise<PacketModel[]> {

    if (states.CANDIDATE !== this.mokka.state) {
      const reply = await this.messageApi.packet(
        messageTypes.ERROR,
        packet.publicKey,
        'No longer a candidate, ignoring vote');
      return [reply];
    }

    if (!packet.data.signature) {
      const reply = await this.messageApi.packet(
        messageTypes.ERROR,
        packet.publicKey,
        'the vote hasn\'t been singed, ignoring vote');
      return [reply];
    }

    const localShare = this.mokka.vote.shares.find((share) => share.publicKey === packet.publicKey);

    if (!localShare) {
      const reply = await this.messageApi.packet(
        messageTypes.ERROR,
        packet.publicKey,
        'the share has not been found');
      return [reply];
    }

    const isSigned = nacl.sign.detached.verify(
      Buffer.from(localShare.share),
      Buffer.from(packet.data.signature, 'hex'),
      Buffer.from(packet.publicKey, 'hex')
    );

    if (!isSigned) {
      const reply = await this.messageApi.packet(
        messageTypes.ERROR,
        packet.publicKey,
        'wrong share for vote provided!');
      return [reply];
    }

    if (localShare.voted) {
      const reply = await this.messageApi.packet(
        messageTypes.ERROR,
        packet.publicKey,
        'already voted for this candidate!');
      return [reply];
    }

    localShare.voted = true;
    localShare.signature = packet.data.signature;

    const votedAmount = this.mokka.vote.shares.filter((share) => share.voted).length;

    if (!this.mokka.quorum(votedAmount))
      return [];

    const validatedShares = this.mokka.vote.shares
      .filter((share) => share.voted)
      .map((share: { share: string }) => share.share);

    const comb = secrets.combine(validatedShares);

    if (comb !== this.mokka.vote.secret) {
      this.mokka.vote = new VoteModel();
      return [];
    }

    const votedShares = this.mokka.vote.shares.filter((share) => share.voted);

    let compacted = votedShares
      .sort((share1, share2) => share1.share > share2.share ? -1 : 1)
      .reduce((result: string, item: { share: string, signature: string }) => {
        return `${result}${item.share}${item.signature}`;
      }, '');

    compacted = `${votedShares.length.toString(16)}x${compacted}x${this.mokka.term}x${this.mokka.vote.started}`;
    this.mokka.setState(states.LEADER, this.mokka.term, this.mokka.publicKey, compacted);

    this.mokka.timer.heartbeat(this.mokka.heartbeat);
    // todo send immediate heartbeat
    for (const node of this.mokka.nodes.values()) {
      const packet = await this.messageApi.packet(messageTypes.ACK, node.publicKey);
      await this.messageApi.message(packet);
    }

    return [];
  }
}

export {VoteApi};
