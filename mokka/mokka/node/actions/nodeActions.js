const _ = require('lodash'),
  Multiaddr = require('multiaddr'),
  hashUtils = require('../../utils/hashes'),
  speakeasy = require('speakeasy'),
  Promise = require('bluebird'),
  secrets = require('secrets.js-grempe'),
  messageTypes = require('../factories/messageTypesFactory'),
  states = require('../factories/stateFactory');

const join = function (multiaddr, write) {

  const m = Multiaddr(multiaddr);

  const publicKey = hashUtils.getHexFromIpfsHash(m.getPeerId());
  if (this.publicKey === publicKey)
    return;

  const mOptions = m.toOptions();

  let node = this.clone({
    write: write,
    publicKey: publicKey,
    address: `${mOptions.transport}://${mOptions.host}:${mOptions.port}`,
    state: states.CHILD
  });

  node.once('end', () => this.leave(node));

  this.nodes.push(node);
  this.emit('join', node);

  return node;
};

const leave = function (publicKey) {
  let index = -1,
    node;

  for (let i = 0; i < this.nodes.length; i++) {
    if (this.nodes[i] === publicKey || this.nodes[i].publicKey === publicKey) {
      node = this.nodes[i];
      index = i;
      break; //todo refactor
    }
  }

  if (~index && node) {
    this.nodes.splice(index, 1);

    if (node.end)
      node.end();

    this.emit('leave', node);
  }

  return node;
};

const end = function () {

  if (states.STOPPED === this.state)
    return false;

  this.change({state: states.STOPPED});

  if (this.nodes.length)
    for (let i = 0; i < this.nodes.length; i++)
      this.leave(this.nodes[i]);


  this.emit('end');
  this.timers.end();
  this.removeAllListeners();
  this.log.end();

  this.timers = this.Log = this.beat = this.election = null;
  return true;
};

const promote = async function (priority = 1) {

  if (this.votes.for && this.votes.for === this.publicKey) {
    console.log(`[${Date.now()}]already promoted myself[${this.index}]`);
    return;
  }

  let {term: currentTerm} = await this.log.getLastInfo();
  let {hash: prevTermHash} = await this.log.getFirstEntryByTerm(this.term - 1);

  this.change({
    state: states.CANDIDATE,  // We're now a candidate,
    term: currentTerm + 1,    // but only for this term. //todo check
    leader: ''              // We no longer have a leader.
  });

  this.votes.for = this.publicKey;
  this.votes.granted = 1;
  this.votes.started = Date.now();

  let token = speakeasy.totp({
    secret: this.networkSecret,
    //step: this.election.max / 1000
    step: 30
  });

  this.votes.secret = secrets.str2hex(token);
  this.votes.shares = [];

  const followerNodes = _.filter(this.nodes, node => node.state !== states.LEADER);

  if (followerNodes.length !== 0) {

    let shares = secrets.share(this.votes.secret, followerNodes.length, Math.ceil(followerNodes.length / 2) + 1);

    for (let index = 0; index < followerNodes.length; index++) {
      this.votes.shares.push({
        share: shares[index],
        publicKey: followerNodes[index].publicKey,
        voted: false
      });

      const packet = await this.actions.message.packet(messageTypes.VOTE, {
        share: shares[index],
        priority: priority,
        prevTermHash: prevTermHash
      });
      this.actions.message.message(followerNodes[index].publicKey, packet);
    }
  }

  if (this.timers.active('term_change'))
    this.timers.clear('term_change');

  this.timers.setTimeout('term_change', async () => {

    console.log(`[${Date.now()}]clean up vote[${this.index}]: ${this.state}`);
    this.votes.for = null;
    this.votes.granted = 0;
    this.votes.shares = [];
    this.votes.secret = null;
    this.votes.started = null;
    if (this.state === states.CANDIDATE)
      this.change({state: states.FOLLOWER, term: this.term - 1});
  }, this.election.max * _.random(1, 5));

};


module.exports = (instance) => {

  _.set(instance, 'actions.node', {
    promote: promote.bind(instance),
    join: join.bind(instance),
    leave: leave.bind(instance),
    end: end.bind(instance)
  });

};