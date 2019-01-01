const _ = require('lodash'),
  Multiaddr = require('multiaddr'),
  hashUtils = require('../../utils/hashes'),
  speakeasy = require('speakeasy'),
  secrets = require('secrets.js-grempe'),
  messageTypes = require('../factories/messageTypesFactory'),
  Web3 = require('web3'),
  web3 = new Web3(),
  cloneNode = require('../../utils/cloneNode'),
  sem = require('semaphore')(1),
  states = require('../factories/stateFactory');

const join = function (multiaddr, write) {

  const m = Multiaddr(multiaddr);

  const publicKey = hashUtils.getHexFromIpfsHash(m.getPeerId());
  if (this.publicKey === publicKey)
    return;

  const mOptions = m.toOptions();

  let node = cloneNode({
    write: write,
    publicKey: publicKey,
    address: `${mOptions.transport}://${mOptions.host}:${mOptions.port}`,
    state: states.CHILD
  }, this);

  node.once('end', () => this.leave(node));

  this.nodes.push(node);
  this.emit('join', node);

  return node;
};

const leave = function (publicKey) {
  let index = -1,
    node;

  for (let i = 0; i < this.nodes.length; i++)
    if (this.nodes[i] === publicKey || this.nodes[i].publicKey === publicKey) {
      node = this.nodes[i];
      index = i;
      break; //todo refactor
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
      this.actions.node.leave(this.nodes[i]);


  this.emit('end');
  this.time.timers.end();
  this.removeAllListeners();
  this.log.end();

  this.time.timers = this.Log = this.beat = this.election = null;
  return true;
};

const promote = async function () {

  return await new Promise(res => {


    sem.take(async () => {

      let blackListed = this.cache.get(`blacklist.${this.publicKey}`);

      if (blackListed) {
        this.logger.trace('awaiting for next rounds');
        sem.leave();
        return res();
      }

      let locked = this.cache.get('commit.locked');

      if (locked) {
        this.logger.trace('awaiting for new possible leader');
        sem.leave();
        return res();
      }

      if (this.votes.for && this.votes.for === this.publicKey) {
        this.logger.trace('already promoted myself');
        sem.leave();
        return res();
      }

      this.change({
        state: states.CANDIDATE,
        term: this.lastInfo.term + 1,
        leader: ''
      });

      this.votes.for = this.publicKey;
      this.votes.granted = 1;
      this.votes.started = Date.now();

      let token = speakeasy.totp({
        secret: this.networkSecret,
        //step: this.election.max / 1000
        step: 30, //todo resolve timing calculation
        window: 2
      });

      this.votes.secret = secrets.str2hex(token);
      this.votes.shares = [];


      let shares = secrets.share(this.votes.secret, this.nodes.length + 1, this.majority());

      shares = _.sortBy(shares);

      for (let index = 0; index < this.nodes.length; index++) {
        this.votes.shares.push({
          share: shares[index],
          publicKey: this.nodes[index].publicKey,
          voted: false
        });

        const packet = await this.actions.message.packet(messageTypes.VOTE, {
          share: shares[index]
        });

        this.actions.message.message(this.nodes[index].publicKey, packet);
      }


      const myShare = _.last(shares);
      const {signature} = web3.eth.accounts.sign(myShare, `0x${this.privateKey}`);

      this.votes.shares.push({
        share: myShare,
        publicKey: this.publicKey,
        signature: signature,
        voted: true
      });


      if (this.time.timers.active('term_change')) //todo move to timerController
        this.time.timers.clear('term_change');

      this.time.timers.setTimeout('term_change', async () => {
        this.logger.trace('clean up passed voting');
        this.votes.for = null;
        this.votes.granted = 0;
        this.votes.shares = [];
        this.votes.secret = null;
        this.votes.started = null;
        if (this.state === states.CANDIDATE)
          this.change({state: states.FOLLOWER, term: this.term - 1});
      }, this.election.max);

      sem.leave();
      res();
    });

  });


};


module.exports = (instance) => {

  _.set(instance, 'actions.node', {
    promote: promote.bind(instance),
    join: join.bind(instance),
    leave: leave.bind(instance),
    end: end.bind(instance)
  });

};
