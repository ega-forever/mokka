import {sortBy} from 'lodash';
// @ts-ignore
import * as secrets from 'secrets.js-grempe';
import * as nacl from 'tweetnacl';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import voteTypes from '../constants/VoteTypes';
import {Mokka} from '../main';
import {PacketModel} from '../models/PacketModel';
import {ReplyModel} from '../models/ReplyModel';
import {VoteModel} from '../models/VoteModel';
import {MessageApi} from './MessageApi';

class VoteApi {

  private mokka: Mokka;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
  }

  public async vote(packet: PacketModel): Promise<ReplyModel> {

    if (!packet.data.share) {
      const reply = await this.messageApi.packet(messageTypes.VOTED, {
        granted: false,
        reason: voteTypes.NO_SHARE,
        signature: null
      });

      return new ReplyModel(reply, packet.publicKey);
    }

    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(packet.data.share),
        Buffer.from(this.mokka.privateKey, 'hex')
      )
    ).toString('hex');

    const lastInfo = await this.mokka.getDb().getState().getInfo();

    if (lastInfo.term <= packet.term || lastInfo.index > packet.last.index) {

      const reply = await this.messageApi.packet(messageTypes.VOTED, {
        granted: false,
        reason: lastInfo.term <= packet.term ?
          voteTypes.CANDIDATE_OUTDATED_BY_TERM : voteTypes.CANDIDATE_OUTDATED_BY_HISTORY,
        signature
      });

      return new ReplyModel(reply, packet.publicKey);
    }

    if (lastInfo.index === packet.last.index && lastInfo.hash !== packet.last.hash) {

      const reply = await this.messageApi.packet(messageTypes.VOTED, {
        granted: false,
        reason: voteTypes.CANDIDATE_HAS_WRONG_HISTORY,
        signature
      });

      return new ReplyModel(reply, packet.publicKey);
    }

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

    const reply = await this.messageApi.packet(messageTypes.VOTED, {
      granted: true,
      signature
    });

    return new ReplyModel(reply, packet.publicKey);
  }

  public async voted(packet: PacketModel): Promise<ReplyModel | null> {

    if (states.CANDIDATE !== this.mokka.state) {
      const reply = await this.messageApi.packet(messageTypes.ERROR, 'No longer a candidate, ignoring vote');
      return new ReplyModel(reply, packet.publicKey);
    }

    if (!packet.data.signature) {
      const reply = await this.messageApi.packet(messageTypes.ERROR, 'the vote hasn\'t been singed, ignoring vote');
      return new ReplyModel(reply, packet.publicKey);
    }

    const localShare = this.mokka.vote.shares.find((share) => share.publicKey === packet.publicKey);

    if (!localShare) {
      const reply = await this.messageApi.packet(messageTypes.ERROR, 'the share has not been found');
      return new ReplyModel(reply, packet.publicKey);
    }

    const isSigned = nacl.sign.detached.verify(
      Buffer.from(localShare.share),
      Buffer.from(packet.data.signature, 'hex'),
      Buffer.from(packet.publicKey, 'hex')
    );

    if (!isSigned) {
      const reply = await this.messageApi.packet(messageTypes.ERROR, 'wrong share for vote provided!');
      return new ReplyModel(reply, packet.publicKey);
    }

    if (localShare.voted) {
      const reply = await this.messageApi.packet(messageTypes.ERROR, 'already voted for this candidate!');
      return new ReplyModel(reply, packet.publicKey);
    }

    localShare.voted = true;
    localShare.signature = packet.data.signature;

    const votedAmount = this.mokka.vote.shares.filter((share) => share.voted).length;

    if (!this.mokka.quorum(votedAmount))
      return null;

    const badVotes = this.mokka.vote.shares.filter((share) => !share.voted);

    if (badVotes.length >= votedAmount - badVotes.length) {

      this.mokka.vote = new VoteModel();

      if (this.mokka.state === states.CANDIDATE) {
        this.mokka.setState(states.FOLLOWER, this.mokka.term + -1, '');
        this.mokka.vote = new VoteModel();
        this.mokka.timer.clearVoteTimeout();
      }

      return null;
    }

    const validatedShares = this.mokka.vote.shares
      .filter((share) => share.voted)
      .map((share: { share: string }) => share.share);

    const comb = secrets.combine(validatedShares);

    if (comb !== this.mokka.vote.secret) {
      this.mokka.vote = new VoteModel();
      return null;
    }

    const votedShares = this.mokka.vote.shares.filter((share) => share.voted);

    let compacted = sortBy(votedShares, 'share')
      .reverse()
      .reduce((result: string, item: { share: string, signature: string }) => {
        return `${result}${item.share}${item.signature}`;
      }, '');

    compacted = `${votedShares.length.toString(16)}x${compacted}${this.mokka.vote.started}`;

    this.mokka.setState(states.LEADER, this.mokka.term, this.mokka.publicKey, compacted);
  }
}

export {VoteApi};
