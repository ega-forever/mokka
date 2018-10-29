const messageTypes = require('../factories/messageTypesFactory'),
  Web3 = require('web3'),
  states = require('../factories/stateFactory'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.actions.vote'}),
  EthUtil = require('ethereumjs-util'),
  web3 = new Web3();


const vote = async function (packet, write) { //todo timeout leader on election


  const {index, hash, createdAt} = await this.log.getLastInfo();

  if (!packet.data.share) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signed: null,
      reason: 'share is not provided'
    });
    return write(reply);
  }

  const signedShare = web3.eth.accounts.sign(packet.data.share, `0x${this.privateKey}`);

  //let timeout = Date.now() - this.votes.started > this.election.max;

  /*
    if (packet.data.priority === 2)
      timeout = this.votes.priority === 1 ? false : Date.now() - this.votes.started > this.election.min;
  */

  /* if (timeout) {
     this.emit(messageTypes.VOTE, packet, false);
     let reply = await this.actions.message.packet(messageTypes.VOTED, {
       granted: false,
       signed: signedShare,
       reason: 'already voted for this time delay',
       code: 0
     });
     return write(reply);
   }*/

  if (index !== 0 && Date.now() - createdAt < this.beat) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signed: signedShare,
      reason: `the voting window hasn't been closed yet`,
      code: 0
    });
    return write(reply);
  }

  if (index !== 0 && Date.now() - createdAt < this.election.max) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signed: signedShare,
      reason: 'it seems that master is still committing',
      code: 1
    });
    return write(reply);
  }

  if (this.votes.for && this.votes.for !== this.publicKey && (this.votes.priority >= packet.data.priority || ((this.votes.started && Date.now() - this.votes.started < this.election.max) || !this.votes.started))) {
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signed: signedShare,
      reason: 'already voted for another candidate',
      code: 2
    });
    return write(reply);
  }


  this.votes.started = Date.now();
  this.votes.priority = packet.data.priority || 1;
  this.votes.share = packet.data.share;

  if (this.term > packet.term) { //in case the candidate is outdated
    this.emit(messageTypes.VOTE, packet, false);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {
      granted: false,
      signed: signedShare,
      reason: 'the candidate is outdated',
      code: 3
    });
    return write(reply);
  }

  if (packet.last.index > index) {
    this.votes.for = packet.publicKey;
    this.emit(messageTypes.VOTE, packet, true);
    let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: true, signed: signedShare});
    return write(reply);
  }

  if (packet.last.index === index && packet.last.hash !== hash) { //todo validation by proof supplied in first commit for entry
    this.votes.for = packet.publicKey;
    this.emit(messageTypes.VOTE, packet, true);
    //this.change({leader: packet.publicKey, term: packet.term});
    let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: true, signed: signedShare});
    return write(reply);
  }

 // let {hash: prevTermHash, term: superTerm} = await this.log.getFirstEntryByTerm(packet.term - 2);


  /*  if(packet.data.prevTermHash !== prevTermHash){
      this.emit(messageTypes.VOTE, packet, false);
      //console.log('we have different history')

      console.log(`[${Date.now()}]wrong history provided[${this.index}]: ${prevTermHash} vs ${packet.data.prevTermHash}, ${packet.term - 2} vs ${superTerm}`)

      let reply = await this.actions.message.packet(messageTypes.VOTED, {
        granted: false,
        signed: signedShare,
        reason: 'wrong history provided',
        code: 4
      });
      return write(reply);
    }*/


  this.votes.for = packet.publicKey;
  this.emit(messageTypes.VOTE, packet, true);
  //this.change({leader: packet.publicKey, term: packet.term});
  this.heartbeat(this.timeout()); //todo validate
  let reply = await this.actions.message.packet(messageTypes.VOTED, {granted: true, signed: signedShare});
  return write(reply);
};

const voted = async function (packet, write) {


  log.info(`received new vote for term[${this.term}]`);

  if (states.CANDIDATE !== this.state) {
    log.info('no longer a candidate');
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'No longer a candidate, ignoring vote');
    return write(reply);
  }

  if (!packet.data.signed) {
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'the vote hasn\'t been singed, ignoring vote');
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
    log.info(`the share hasnt\'t been found on term [${this.term}]`);
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'wrong share for vote provided!');
    return write(reply);
  }

  if (localShare.voted) {
    log.info(`you have already voted for me on term [${this.term}]`);
    let reply = await this.actions.message.packet(messageTypes.ERROR, 'already voted for this candidate!');
    return write(reply);
  }

  localShare.voted = true;
  localShare.granted = packet.data.granted;
  localShare.leader = packet.leader;
  localShare.last = packet.last;
  localShare.signed = packet.data.signed;
  localShare.code = packet.data.code;

  if (!packet.data.granted) {
    log.error(`vote fail due to reason: ${packet.data.reason}`);
  }


  let votedAmount = _.chain(this.votes.shares).filter({voted: true}).size().value();

  if (!this.quorum(votedAmount))
    return;

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


  //in case index < packet.last.index - then we compare the merke root, in case the root is bad - we drop to previous term,
  //otherwise we just ask about the next log

  //todo compare last index with leader's and wait until they will be the same


 // console.log(`[${Date.now()}]bad votes[${this.index}]: ${badVotes.length}, leader: ${leader}`);
 // console.log(`[${Date.now()}]good votes[${this.index}]:${_.filter(this.votes.shares, {granted: true}).length}, leader: ${leader}`);

  if (badVotes.length >= Math.ceil(votedAmount / 2) + 1) {

    this.votes = {
      for: null,
      granted: 0,
      shares: [],
      secret: null
    };


    this.change({term: this.term - 1, state: states.FOLLOWER});
    let reply = await this.actions.message.packet(messageTypes.ACK);
    return write(reply);
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

    let reply = await this.actions.message.packet(messageTypes.ACK);
    return write(reply);
  }

  this.change({leader: this.publicKey, state: states.LEADER});
  let proof = {
    shares: this.votes.shares.map(share => _.pick(share, 'share', 'signed')),
    secret: this.votes.secret
  };

  await this.log.addProof(this.term, proof);

  let reply = await this.actions.message.packet(messageTypes.APPEND);
  reply.proof = proof;

  this.actions.message.message(states.FOLLOWER, reply);

};

module.exports = (instance) => {

  _.set(instance, 'actions.vote', {
    vote: vote.bind(instance),
    voted: voted.bind(instance)
  });

};
