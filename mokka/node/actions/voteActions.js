const messageTypes = require('../factories/messageTypesFactory'),
  Web3 = require('web3'),
  states = require('../factories/stateFactory'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
  voteTypes = require('../factories/voteTypesFactory'),
  restorePubKey = require('../../utils/restorePubKey'),
  calculateVoteDelay = require('../../utils/calculateVoteDelay'),
  web3 = new Web3();


const vote = async function (packet) {


  let blackListed = this.cache.get(`blacklist.${packet.publicKey}`);

  if (blackListed && (blackListed.term < packet.term || blackListed.hash !== packet.last.hash))
    this.cache.del(`blacklist.${packet.publicKey}`);

  const currentTerm = this.state === states.CANDIDATE ? this.term - 1 : this.term;

  if (!packet.data.share) {

    this.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signature: null,
      reason: voteTypes.NO_SHARE
    });

    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  const {signature} = web3.eth.accounts.sign(packet.data.share, `0x${this.privateKey}`);


  if (blackListed) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signature: signature,
      reason: voteTypes.BLACKLISTED_UNTIL_NEXT_TERM
    });

    return {
      reply: reply,
      who: packet.publicKey
    };
  }


  if (packet.last.index !== 0 && Date.now() - this.lastInfo.createdAt < this.beat) {
    this.emit(messageTypes.VOTE, packet, false);

    this.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signature: signature,
      reason: voteTypes.VOTING_WINDOW_IS_NOT_CLOSED
    });

    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  if (packet.last.index !== 0 && Date.now() - this.lastInfo.createdAt < this.election.max) {
    this.emit(messageTypes.VOTE, packet, false);

    this.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

    let reply = await this.actions.message.packet(messageTypes.VOTED, {
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
    this.emit(messageTypes.VOTE, packet, false);

    this.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, Infinity);

    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signature: signature,
      reason: voteTypes.CANDIDATE_OUTDATED_BY_TERM
    });
    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  if (this.lastInfo.index > packet.last.index) {
    let log = await this.log.get(packet.last.index);

    if (log && log.hash === packet.last.hash) {

      this.emit(messageTypes.VOTE, packet, false);

      this.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, this.election.max);

      let reply = await this.actions.message.packet(messageTypes.VOTED, {
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


  if (this.lastInfo.index === packet.last.index && this.lastInfo.hash !== packet.last.hash) {

    this.emit(messageTypes.VOTE, packet, false);

    this.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, this.election.max);

    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signature: signature,
      reason: voteTypes.CANDIDATE_HAS_WRONG_HISTORY
    });
    return {
      reply: reply,
      who: packet.publicKey
    };
  }



  //todo votee with more priority will rewrite the voting for itself
  // if (this.votes.for && this.votes.for !== this.publicKey && (this.votes.started && Date.now() - this.votes.started < this.election.max)) {//todo make rule, that will enable votee to vote
  if (this.votes.for && (this.votes.started && Date.now() - this.votes.started < this.election.max)) {//todo make rule, that will enable votee to vote

    let ttl = await calculateVoteDelay(currentTerm, packet.publicKey, this);
    this.logger.trace(`blacklisting ${packet.publicKey} for ${ttl} under term: ${packet.term}`);
    if (ttl)
      this.cache.set(`blacklist.${packet.publicKey}`, {term: packet.term, hash: packet.last.hash}, ttl);


    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signature: signature,
      reason: voteTypes.ALREADY_VOTED
    });
    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  this.votes.for = packet.publicKey;
  this.votes.started = Date.now();
  this.votes.share = packet.data.share;

  if (blackListed)
    this.cache.del(`blacklist.${packet.publicKey}`);

  if (packet.last.index > this.lastInfo.index) {
    this.emit(messageTypes.VOTE, packet, true);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: true,
      signature: signature
    });
    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  if (packet.last.index === this.lastInfo.index && packet.last.hash !== this.lastInfo.hash) {
    this.emit(messageTypes.VOTE, packet, true);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: true,
      signature: signature
    });
    return {
      reply: reply,
      who: packet.publicKey
    };
  }


  this.emit(messageTypes.VOTE, packet, true);
  this.heartbeat(this.timeout());
  let reply = await this.actions.message.packet(messageTypes.VOTED, {
    granted: true,
    signature: signature
  });
  return {
    reply: reply,
    who: packet.publicKey
  };
};

const voted = async function (packet) {


  this.logger.trace(`received new vote for term[${this.term}] with reason: ${packet.data.reason} from peer: ${packet.publicKey}`);

  if (states.CANDIDATE !== this.state) {
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'No longer a candidate, ignoring vote');
    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  if (!packet.data.signature) {
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'the vote hasn\'t been singed, ignoring vote');
    return {
      reply: reply,
      who: packet.publicKey
    };
  }


  let localShare = _.find(this.votes.shares, {publicKey: packet.publicKey});
  const restoredPublicKey = restorePubKey(localShare.share, packet.data.signature);


  if (localShare.publicKey !== restoredPublicKey) {

    let reply = await this.actions.message.packet(messageTypes.ERROR, 'wrong share for vote provided!');
    return {
      reply: reply,
      who: packet.publicKey
    };
  }

  if (localShare.voted) {
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'already voted for this candidate!');
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
    this.logger.trace(`vote fail due to reason: ${packet.data.reason}`);

  let votedAmount = _.chain(this.votes.shares).filter({voted: true}).size().value();

  if (!this.quorum(votedAmount))
    return;

  let badVotes = _.filter(this.votes.shares, {granted: false});

  if (badVotes.length >= votedAmount - badVotes.length) {

    this.votes = {
      for: null,
      granted: 0,
      shares: [],
      secret: null
    };

    if (packet.data.reason === voteTypes.ALREADY_VOTED || packet.data.reason === voteTypes.MASTER_STILL_COMMITTING) { //todo change to reason
      const currentTerm = this.state === states.CANDIDATE ? this.term - 1 : this.term;
      const ttl = packet.data.reason === voteTypes.ALREADY_VOTED ? await calculateVoteDelay(currentTerm, this.publicKey, this) : this.election.max;
      this.cache.set(`blacklist.${this.publicKey}`, {term: this.term - 1, hash: packet.last.hash}, ttl);
    }


    if (this.state === states.CANDIDATE) {

      this.change({term: this.term - 1, state: states.FOLLOWER});
      if (this.timers.active('term_change'))
        this.timers.clear('term_change');


      this.logger.trace('clean up passed voting');
      this.votes.for = null;
      this.votes.granted = 0;
      this.votes.shares = [];
      this.votes.secret = null;
      this.votes.started = null;
    }

    return;
  }


  let validatedShares = this.votes.shares.map(share => share.share);

  let comb = secrets.combine(validatedShares);

  if (comb !== this.votes.secret) {
    this.votes = {
      for: null,
      granted: 0,
      shares: [],
      secret: null
    };

    return;
  }

  this.change({leader: this.publicKey, state: states.LEADER});

  const votedShares = _.chain(this.votes.shares).compact().filter(vote => vote.voted).value();

  const compacted = _.chain(votedShares).sortBy('share')
    .reverse().reduce((result, item) => {
      return `${result}${item.share}${item.signature.replace('0x', '')}`;
    }, '').thru(item => `${votedShares.length.toString(16)}x${item}${this.votes.started}`).value();

  await this.log.addProof(this.term, {
    index: -1,
    hash: null,
    proof: compacted
  });

  let reply = await this.actions.message.appendPacket();

  return {
    reply: reply,
    who: states.FOLLOWER
  };


};

module.exports = (instance) => {

  _.set(instance, 'actions.vote', {
    vote: vote.bind(instance),
    voted: voted.bind(instance)
  });

};
