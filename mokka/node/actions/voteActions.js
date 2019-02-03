const messageTypes = require('../factories/messageTypesFactory'),
  Web3 = require('web3'),
  states = require('../factories/stateFactory'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
  voteTypes = require('../factories/voteTypesFactory'),
  restorePubKey = require('../../utils/restorePubKey'),
  calculateVoteDelay = require('../../utils/calculateVoteDelay'),
  web3 = new Web3();


class VoteActions {
  constructor (mokka) {
    this.mokka = mokka;
  }


  async vote (packet) {


    let blackListed = this.mokka.cache.get(`blacklist.${packet.publicKey}`);

    if (blackListed && (blackListed.term < packet.term || blackListed.hash !== packet.last.hash))
      this.mokka.cache.del(`blacklist.${packet.publicKey}`);

    const currentTerm = this.mokka.state === states.CANDIDATE ? this.mokka.term - 1 : this.mokka.term;

    if (!packet.data.share) {

      this.mokka.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

      this.mokka.emit(messageTypes.VOTE, packet, false);
      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signature: null,
        reason: voteTypes.NO_SHARE
      });

      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    const {signature} = web3.eth.accounts.sign(packet.data.share, `0x${this.mokka.privateKey}`);


    if (blackListed) {
      this.mokka.emit(messageTypes.VOTE, packet, false);
      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signature: signature,
        reason: voteTypes.BLACKLISTED_UNTIL_NEXT_TERM
      });

      return {
        reply: reply,
        who: packet.publicKey
      };
    }


    if (packet.last.index !== 0 && Date.now() - this.mokka.lastInfo.createdAt < this.mokka.beat) {
      this.mokka.emit(messageTypes.VOTE, packet, false);

      this.mokka.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signature: signature,
        reason: voteTypes.VOTING_WINDOW_IS_NOT_CLOSED
      });

      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    if (packet.last.index !== 0 && Date.now() - this.mokka.lastInfo.createdAt < this.mokka.election.max) {
      this.mokka.emit(messageTypes.VOTE, packet, false);

      this.mokka.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signature: signature,
        reason: voteTypes.MASTER_STILL_COMMITTING
      });
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    if (currentTerm > packet.term) { //in case the candidate is outdated by term
      this.mokka.emit(messageTypes.VOTE, packet, false);

      this.mokka.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signature: signature,
        reason: voteTypes.CANDIDATE_OUTDATED_BY_TERM
      });
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    if (this.mokka.lastInfo.index > packet.last.index) {
      let log = await this.mokka.log.entry.get(packet.last.index);

      if (log && log.hash === packet.last.hash) {

        this.mokka.emit(messageTypes.VOTE, packet, false);

        this.mokka.cache.set(`blacklist.${packet.publicKey}`, {
          term: packet.term,
          hash: packet.last.hash
        }, this.mokka.election.max);

        let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
          granted: false,
          signature: signature,
          reason: voteTypes.CANDIDATE_OUTDATED_BY_HISTORY
        });
        return {
          reply: reply,
          who: packet.publicKey
        };

      }
    }


    if (this.mokka.lastInfo.index === packet.last.index && this.mokka.lastInfo.hash !== packet.last.hash) {

      this.mokka.emit(messageTypes.VOTE, packet, false);

      this.mokka.cache.set(`blacklist.${packet.publicKey}`, {
        term: packet.term,
        hash: packet.last.hash
      }, this.mokka.election.max);

      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signature: signature,
        reason: voteTypes.CANDIDATE_HAS_WRONG_HISTORY
      });
      return {
        reply: reply,
        who: packet.publicKey
      };
    }


    if (this.mokka.votes.for && (this.mokka.votes.started && Date.now() - this.mokka.votes.started < this.mokka.election.max)) {//todo make rule, that will enable votee to vote

      let ttl = await calculateVoteDelay(currentTerm, packet.publicKey, this.mokka);
      this.mokka.logger.trace(`blacklisting ${packet.publicKey} for ${ttl} under term: ${packet.term}`);
      if (ttl)
        this.mokka.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, ttl);


      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signature: signature,
        reason: voteTypes.ALREADY_VOTED
      });
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    this.mokka.votes.for = packet.publicKey;
    this.mokka.votes.started = Date.now();
    this.mokka.votes.share = packet.data.share;

    if (blackListed)
      this.mokka.cache.del(`blacklist.${packet.publicKey}`);

    if (packet.last.index > this.mokka.lastInfo.index) {
      this.mokka.emit(messageTypes.VOTE, packet, true);
      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: true,
        signature: signature
      });
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    if (packet.last.index === this.mokka.lastInfo.index && packet.last.hash !== this.mokka.lastInfo.hash) {
      this.mokka.emit(messageTypes.VOTE, packet, true);
      let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
        granted: true,
        signature: signature
      });
      return {
        reply: reply,
        who: packet.publicKey
      };
    }


    this.mokka.emit(messageTypes.VOTE, packet, true);
    this.mokka.time.heartbeat(this.mokka.time.timeout());
    let reply = await this.mokka.actions.message.packet(messageTypes.VOTED, {
      granted: true,
      signature: signature
    });
    return {
      reply: reply,
      who: packet.publicKey
    };
  }


  async voted (packet) {


    this.mokka.logger.trace(`received new vote for term[${this.term}] with reason: ${packet.data.reason} from peer: ${packet.publicKey}`);

    if (states.CANDIDATE !== this.mokka.state) {
      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'No longer a candidate, ignoring vote');
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    if (!packet.data.signature) {
      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'the vote hasn\'t been singed, ignoring vote');
      return {
        reply: reply,
        who: packet.publicKey
      };
    }


    let localShare = _.find(this.mokka.votes.shares, {publicKey: packet.publicKey});
    const restoredPublicKey = restorePubKey(localShare.share, packet.data.signature);


    if (localShare.publicKey !== restoredPublicKey) {

      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'wrong share for vote provided!');
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    if (localShare.voted) {
      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'already voted for this candidate!');
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    localShare.voted = true;
    localShare.granted = packet.data.granted;
    localShare.signature = packet.data.signature;
    localShare.reason = packet.data.reason;

    if (!packet.data.granted)
      this.mokka.logger.trace(`vote fail due to reason: ${packet.data.reason}`);

    let votedAmount = _.chain(this.mokka.votes.shares).filter({voted: true}).size().value();

    if (!this.mokka.quorum(votedAmount))
      return;

    let badVotes = _.filter(this.mokka.votes.shares, {granted: false});

    if (badVotes.length >= votedAmount - badVotes.length) {

      this.mokka.votes = {
        for: null,
        granted: 0,
        shares: [],
        secret: null
      };

      if (packet.data.reason === voteTypes.ALREADY_VOTED || packet.data.reason === voteTypes.MASTER_STILL_COMMITTING) { //todo change to reason
        const currentTerm = this.mokka.state === states.CANDIDATE ? this.mokka.term - 1 : this.mokka.term;
        const ttl = packet.data.reason === voteTypes.ALREADY_VOTED ? await calculateVoteDelay(currentTerm, this.mokka.publicKey, this.mokka) : this.mokka.election.max;
        this.mokka.cache.set(`blacklist.${this.mokka.publicKey}`, {
          term: this.mokka.term - 1,
          hash: packet.last.hash
        }, ttl);
      }


      if (this.mokka.state === states.CANDIDATE) {

        this.mokka.change({term: this.mokka.term - 1, state: states.FOLLOWER});
        if (this.mokka.time.timers.active('term_change'))
          this.mokka.time.timers.clear('term_change');


        this.mokka.logger.trace('clean up passed voting');
        this.mokka.votes.for = null;
        this.mokka.votes.granted = 0;
        this.mokka.votes.shares = [];
        this.mokka.votes.secret = null;
        this.mokka.votes.started = null;
      }

      return;
    }


    let validatedShares = this.mokka.votes.shares.map(share => share.share);

    let comb = secrets.combine(validatedShares);

    if (comb !== this.mokka.votes.secret) {
      this.mokka.votes = {
        for: null,
        granted: 0,
        shares: [],
        secret: null
      };

      return;
    }

    this.mokka.change({leader: this.mokka.publicKey, state: states.LEADER});

    const votedShares = _.chain(this.mokka.votes.shares).compact().filter(vote => vote.voted).value();

    const compacted = _.chain(votedShares).sortBy('share')
      .reverse().reduce((result, item) => {
        return `${result}${item.share}${item.signature.replace('0x', '')}`;
      }, '').thru(item => `${votedShares.length.toString(16)}x${item}${this.mokka.votes.started}`).value();

    await this.mokka.log.proof.add(this.mokka.term, {
      index: -1,
      hash: null,
      proof: compacted
    });

    let reply = await this.mokka.actions.message.appendPacket();

    return {
      reply: reply,
      who: states.FOLLOWER
    };

  }
}

module.exports = VoteActions;
