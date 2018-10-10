const messageTypes = require('../factories/messageTypesFactory'),
  Web3 = require('web3'),
  states = require('../factories/stateFactory'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
  Promise = require('bluebird'),
  EthUtil = require('ethereumjs-util'),
  web3 = new Web3();


const vote = async function (packet, write) {

  const {index, term, hash} = await this.log.getLastInfo();


  if (index) {

    let lastEntry = await this.log.getLastEntry();

    /*  console.log(lastEntry)
      if(!lastEntry.committed){
        this.emit(messageTypes.VOTE, packet, false);
        return write(await this.actions.message.packet(messageTypes.VOTED, {granted: false}));
      }*/

    let reply = await this.actions.message.packet(messageTypes.STATE);
    await this.actions.message.message(lastEntry.owner, reply);

    let state = await new Promise(res => this.once(states.STATE_RECEIVED, res)).timeout(this.election.max).catch(() => null);

    if (state && (state.index !== index || !state.committed || state.publicKey !== lastEntry.owner)) {
   // if (state && (state.index !== index)) {
      this.emit(messageTypes.VOTE, packet, false);
      return write(await this.actions.message.packet(messageTypes.VOTED, {granted: false}));
    }


  }


  if (!packet.data.share) {
    this.emit(messageTypes.VOTE, packet, false);
    return write(await this.actions.message.packet(messageTypes.VOTED, {granted: false}));
  }


  const signedShare = web3.eth.accounts.sign(packet.data.share, `0x${this.privateKey}`);

  if (this.votes.for && this.votes.for !== packet.publicKey) {
    this.emit(messageTypes.VOTE, packet, false);
    return write(await this.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare}));
  }


  if ((index > packet.last.index && term > packet.last.term) || packet.last.hash !== hash || packet.last.committedIndex < this.log.committedIndex) {
    //if (index > packet.last.index && term > packet.last.term) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare});
    return write(reply);
  }
  //todo voting based on sync state
  //rule 1 - dominate vote comes from the previous master node (from where logs are repapulate to the followers) + each
  // follower provide its state with merkle proof based on the last index received from candidate

  //rule 2 - the previous master node is not available. In this case, we vote by the majority of voices


  this.votes.for = packet.publicKey;
  this.emit(messageTypes.VOTE, packet, true);
  this.change({leader: packet.publicKey, term: packet.term});
  let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: true, signed: signedShare});
  write(reply);
  this.heartbeat(this.timeout());
};

const voted = async function (packet, write) {

  if (states.CANDIDATE !== this.state) {
    let reply = await this.actions.message.packet(states.ERROR, 'No longer a candidate, ignoring vote');
    return write(reply);
  }

  if (!packet.data.signed) {
    const reply = await this.actions.message.packet(states.ERROR, 'the vote hasn\'t been singed, ignoring vote');
    return write(reply);
  }

  const restoredPublicKey = EthUtil.ecrecover(
    Buffer.from(packet.data.signed.messageHash.replace('0x', ''), 'hex'),
    parseInt(packet.data.signed.v),
    Buffer.from(packet.data.signed.r.replace('0x', ''), 'hex'),
    Buffer.from(packet.data.signed.s.replace('0x', ''), 'hex')).toString('hex');

  let localShare = _.find(this.votes.shares, {
    publicKey: restoredPublicKey,
    share: packet.data.signed.message,
    voted: false
  });

  if (!localShare)
    return write(await this.actions.message.packet(states.ERROR, 'wrong share for vote provided!'));

  localShare.voted = true;


  if (packet.data.granted)
    this.votes.granted++;

  if (this.quorum(this.votes.granted)) {

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
    const reply = await this.actions.message.packet(messageTypes.APPEND);
    this.actions.message.message(states.FOLLOWER, reply);
  }
  write();
};

const orphanVote = async function (packet, write) {

  let entry = await this.log.get(packet.data.index);

  if (!entry) {
    let reply = await this.actions.message.packet(messageTypes.ORPHAN_VOTED, {
      provided: packet.data.hash,
      accepted: null
    });
    return write(reply);
  }


  let reply = await this.actions.message.packet(messageTypes.ORPHAN_VOTED, {
    provided: packet.data.hash,
    accepted: entry.hash
  });
  return write(reply);
};

const orphanVoted = async function (packet) {


  if (this.orhpanVotes.for !== packet.data.provided)
    return;

  if (this.orhpanVotes.for === packet.data.accepted)
    this.orhpanVotes.positive++;


  if (this.orhpanVotes.for !== packet.data.accepted)
    this.orhpanVotes.negative++;

  if (this.orhpanVotes.negative + this.orhpanVotes.positive < this.majority())
    return;

  if (this.orhpanVotes.negative >= this.orhpanVotes.positive) {//todo rollback
    console.log('reset node state');

    await this.log.removeEntriesAfter(0);
    this.log.committedIndex = 0;
    return;
  }

  if (this.orhpanVotes.positive >= this.orhpanVotes.negative) {
    this.orhpanVotes = {
      for: null,
      negative: 0,
      positive: 0
    }
  }

};

module.exports = (instance) => {

  _.set(instance, 'actions.vote', {
    vote: vote.bind(instance),
    voted: voted.bind(instance),
    orphanVote: orphanVote.bind(instance),
    orphanVoted: orphanVoted.bind(instance)
  });

};
