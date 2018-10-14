const messageTypes = require('../factories/messageTypesFactory'),
  Web3 = require('web3'),
  states = require('../factories/stateFactory'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
  EthUtil = require('ethereumjs-util'),
  web3 = new Web3();


const vote = async function (packet, write) { //todo timeout leader on election


  const {index, hash, createdAt} = await this.log.getLastInfo();

  const signedShare = web3.eth.accounts.sign(packet.data.share, `0x${this.privateKey}`);

  let timeout = Date.now() - this.votes.started > this.election.max;

  if (packet.data.priority === 2)
    timeout = this.votes.priority === 1 ? false : Date.now() - this.votes.started > this.election.min;

  if (timeout || !packet.data.share || (Date.now() - createdAt < this.election.max && index !== 0)) {
    // if (!packet.data.share || (Date.now() - createdAt < this.election.max && index !== 0)) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare});
    return write(reply);
  }

/*  if(this.state === states.LEADER){
    this.change({state: states.FOLLOWER, leader: ''});
    this.heartbeat(this.timeout());
  }*/

  this.votes.started = Date.now();
  this.votes.started = packet.data.priority || 1;

  if (this.votes.for && this.votes.for !== packet.publicKey) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare});
    return write(reply);
  }

  //provide merkleroot, in case packet.last.index < index

  if (index > packet.last.index) { //in case the candidate is outdated
    this.emit(messageTypes.VOTE, packet, false);

    //todo build proof

    /*    let ensureIndex = packet.last.index > 5 ? packet.last.index - 5 : 0;
        let ensureLimit = packet.last.index > 5 ? 5 : packet.last.index;

        let entries = await this.log.getEntriesAfterIndex(ensureIndex, ensureIndex);
        */

    let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare});
    return write(reply);
  }

  if (index !== packet.last.index || packet.last.hash !== hash) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: false, signed: signedShare});
    return write(reply);
  }


  this.votes.for = packet.publicKey;
  this.emit(messageTypes.VOTE, packet, true);
  this.change({leader: packet.publicKey, term: packet.term});
  let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: true, signed: signedShare});
  //this.heartbeat(this.timeout());
  return write(reply);
};

const voted = async function (packet, write) {

  console.log(`i am going to be voted[${this.index}]`)

  if (states.CANDIDATE !== this.state) {
    console.log(`my state[${this.index}]: `, this.state)
    let reply = await this.actions.message.packet(states.ERROR, 'No longer a candidate, ignoring vote');
    return write(reply);
  }

  if (!packet.data.signed) {
    let reply = await this.actions.message.packet(states.ERROR, 'the vote hasn\'t been singed, ignoring vote');
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

  if (!localShare) {
    let reply = await this.actions.message.packet(states.ERROR, 'wrong share for vote provided!');
    return write(reply);
  }

  if (localShare.voted) {
    let reply = await this.actions.message.packet(states.ERROR, 'already voted for this candidate!');
    return write(reply);
  }

  localShare.voted = true;
  localShare.granted = packet.data.granted;
  localShare.leader = packet.leader;
  localShare.last = packet.last;

  // console.log(packet.data)

  /*  if (packet.data.granted)
      this.votes.granted++;*/

  let votedAmount = _.chain(this.votes.shares).filter({voted: true}).size().value();

  if (!this.quorum(votedAmount))
    return;

  console.log(`quorum[${this.index}]`)


  let badVotes = _.filter(this.votes.shares, {granted: false});
  let leader = _.chain(this.votes.shares)
    .transform((result, item) => {
      if (item.leader)
        result[item.leader] = (result[item.leader] || 0) + 1;
    }, {})
    .toPairs()
    .map(pair => ({
      total: pair[1],
      leader: pair[0]
    }))
    .sortBy('total')
    .last()
    .get('leader')
    .value();

  let maxLeaderIndex = _.chain(this.votes.shares)
    .find({publicKey: leader})
    .get('last.index', 0)
    .value();

  if (!maxLeaderIndex)
    maxLeaderIndex = _.chain(this.votes.shares)
      .sortBy(share => _.get(share, 'last.index', 0))
      .last()
      .get('last.index', 0)
      .value();

  //in case index < packet.last.index - then we compare the merke root, in case the root is bad - we drop to previous term,
  //otherwise we just ask about the next log

  //todo compare last index with leader's and wait until they will be the same


  console.log(`bad votes[${this.index}]: ${badVotes.length}, leader: ${leader}`);
  console.log(`good votes[${this.index}]:${_.filter(this.votes.shares, {granted: true}).length}, leader: ${leader}`);

  if (this.quorum(badVotes.length)) {

    this.votes = {
      for: null,
      granted: 0,
      shares: [],
      secret: null
    };

    let reply = await this.actions.message.packet(messageTypes.ACK);
    return write(reply);

/*
    console.log(this.votes.shares);
    process.exit(0)


    const {index: index, committed: committed} = await this.log.getLastEntry();

    console.log(`master index is[${this.index}]`, maxLeaderIndex, 'while mine is', index);
    console.log(`master is[${this.index}]: ${leader}`);
    console.log(`changes are committed[${this.index}]: ${committed}`);

    if (maxLeaderIndex > 0 && index < maxLeaderIndex && committed) {

      let reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: index.index + 1});
      console.log(`leader[${this.index}]: `, leader);
      this.change({leader: leader, state: states.FOLLOWER});
      return await this.actions.message.message(leader, reply);
    }
*/


  }

  /*  if (this.quorum(badVotes.length) && leader && packet.last.index !== 0) { //todo make rule for drop history

    let prevTerm = await this.log.getLastEntryForPrevTerm();

    console.log(`dropping to previous term after vote: ${prevTerm.index + 1} -> ${prevTerm.index}`)

    await this.log.removeEntriesAfter(prevTerm.index);
    this.log.committedIndex = prevTerm.index;
    this.term = prevTerm.index;

    //todo stage
    let reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: prevTerm.index + 1});
    console.log(`leader[${this.index}]: `, leader);
    this.change({leader: leader, state: states.FOLLOWER});
    return await this.actions.message.message(leader, reply);
  }*/


  let validatedShares = this.votes.shares.map(share => share.share);

  let comb = secrets.combine(validatedShares);

  if (comb !== this.votes.secret) {
    this.votes = {
      for: null,
      granted: 0,
      shares: [],
      secret: null
    };

    let reply = await this.actions.message.packet(messageTypes.ACK);
    return write(reply);
  }

  this.change({leader: this.publicKey, state: states.LEADER});
  const reply = await this.actions.message.packet(messageTypes.APPEND);
  this.actions.message.message(states.FOLLOWER, reply);

};

module.exports = (instance) => {

  _.set(instance, 'actions.vote', {
    vote: vote.bind(instance),
    voted: voted.bind(instance)
  });

};
