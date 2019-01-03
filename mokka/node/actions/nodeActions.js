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


class NodeActions {

  constructor (mokka) {
    this.mokka = mokka;
  }


  async join (multiaddr, write) {

    const m = Multiaddr(multiaddr);

    const publicKey = hashUtils.getHexFromIpfsHash(m.getPeerId());
    if (this.mokka.publicKey === publicKey)
      return;

    const mOptions = m.toOptions();

    let node = cloneNode({
      write: write,
      publicKey: publicKey,
      address: `${mOptions.transport}://${mOptions.host}:${mOptions.port}`,
      state: states.CHILD
    }, this.mokka);

    node.once('end', () => this.leave(node));

    this.mokka.nodes.push(node);
    this.mokka.emit('join', node);

    this.mokka.gossip.handleNewPeers([publicKey]);

    return node;
  };

  leave (publicKey) {
    let index = -1,
      node;

    for (let i = 0; i < this.mokka.nodes.length; i++)
      if (this.mokka.nodes[i] === publicKey || this.mokka.nodes[i].publicKey === publicKey) {
        node = this.mokka.nodes[i];
        index = i;
        break; //todo refactor
      }


    if (~index && node) {
      this.mokka.nodes.splice(index, 1);

      if (node.end)
        node.end();

      this.mokka.emit('leave', node);
    }

    return node;
  };

  end () {

    if (states.STOPPED === this.mokka.state)
      return false;

    this.mokka.change({state: states.STOPPED});

    if (this.mokka.nodes.length)
      for (let i = 0; i < this.mokka.nodes.length; i++)
        this.mokka.actions.node.leave(this.mokka.nodes[i]);


    this.mokka.emit('end');
    this.mokka.time.timers.end();
    this.mokka.removeAllListeners();
    this.mokka.log.end();

    this.mokka.time.timers = this.mokka.Log = this.mokka.beat = this.mokka.election = null;
    return true;
  };


  async promote () {

    return await new Promise(res => {


      sem.take(async () => {

        let blackListed = this.mokka.cache.get(`blacklist.${this.mokka.publicKey}`);

        if (blackListed) {
          this.mokka.logger.trace('awaiting for next rounds');
          sem.leave();
          return res();
        }

        let locked = this.mokka.cache.get('commit.locked');

        if (locked) {
          this.mokka.logger.trace('awaiting for new possible leader');
          sem.leave();
          return res();
        }

        if (this.mokka.votes.for && this.mokka.votes.for === this.mokka.publicKey) {
          this.mokka.logger.trace('already promoted myself');
          sem.leave();
          return res();
        }

        this.mokka.change({
          state: states.CANDIDATE,
          term: this.mokka.lastInfo.term + 1,
          leader: ''
        });

        this.mokka.votes.for = this.mokka.publicKey;
        this.mokka.votes.granted = 1;
        this.mokka.votes.started = Date.now();

        let token = speakeasy.totp({
          secret: this.mokka.networkSecret,
          //step: this.election.max / 1000
          step: 30, //todo resolve timing calculation
          window: 2
        });

        this.mokka.votes.secret = secrets.str2hex(token);
        this.mokka.votes.shares = [];


        let shares = secrets.share(this.mokka.votes.secret, this.mokka.nodes.length + 1, this.mokka.majority());

        shares = _.sortBy(shares);

        for (let index = 0; index < this.mokka.nodes.length; index++) {
          this.mokka.votes.shares.push({
            share: shares[index],
            publicKey: this.mokka.nodes[index].publicKey,
            voted: false
          });

          const packet = await this.mokka.actions.message.packet(messageTypes.VOTE, {
            share: shares[index]
          });

          this.mokka.actions.message.message(this.mokka.nodes[index].publicKey, packet);
        }


        const myShare = _.last(shares);
        const {signature} = web3.eth.accounts.sign(myShare, `0x${this.mokka.privateKey}`);

        this.mokka.votes.shares.push({
          share: myShare,
          publicKey: this.mokka.publicKey,
          signature: signature,
          voted: true
        });


        if (this.mokka.time.timers.active('term_change')) //todo move to timerController
          this.mokka.time.timers.clear('term_change');

        this.mokka.time.timers.setTimeout('term_change', async () => {
          this.mokka.logger.trace('clean up passed voting');
          this.mokka.votes.for = null;
          this.mokka.votes.granted = 0;
          this.mokka.votes.shares = [];
          this.mokka.votes.secret = null;
          this.mokka.votes.started = null;
          if (this.mokka.state === states.CANDIDATE)
            this.mokka.change({state: states.FOLLOWER, term: this.mokka.term - 1});
        }, this.mokka.election.max);

        sem.leave();
        res();
      });

    });
  };

}

module.exports = NodeActions;
