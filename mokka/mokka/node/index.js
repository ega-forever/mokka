const EventEmitter = require('events'),
  Tick = require('tick-tock'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Wallet = require('ethereumjs-wallet'),
  states = require('./factories/stateFactory'),
  Multiaddr = require('multiaddr'),
  messageTypes = require('./factories/messageTypesFactory'),
  hashUils = require('../utils/hashes'),
  speakeasy = require('speakeasy'),
  VoteActions = require('./actions/voteActions'),
  EthUtil = require('ethereumjs-util'),
  validateSecretUtil = require('../utils/validateSecret'),
  NodeActions = require('./actions/nodeActions'),
  AppendActions = require('./actions/appendActions'),
  secrets = require('secrets.js-grempe'),
  MessageActions = require('./actions/messageActions'),
  Api = require('./api');

const change = require('modification')(' change');

class Mokka extends EventEmitter {
  constructor (options = {}) {
    super();

    AppendActions(this);
    VoteActions(this);
    NodeActions(this);
    MessageActions(this);
    Api(this);

    this.election = {
      min: options.election_min || 150,
      max: options.election_max || 300
    };

    this.beat = options.heartbeat || 50;

    this.votes = {
      for: null,
      granted: 0,
      shares: [],
      secret: null,
      started: null,
      priority: 1
    };

    //this.write = this.write || options.write || null;
    this.threshold = options.threshold || 0.8;
    this.timers = new Tick(this);
    this.Log = options.Log;
    this.change = change;
    this.networkSecret = options.networkSecret || '1234567';
    this.latency = 0;
    this.log = null;
    this.nodes = [];
    this.privateKey = options.privateKey;
    this.publicKey = options.privateKey ? Wallet.fromPrivateKey(Buffer.from(options.privateKey, 'hex')).getPublicKey().toString('hex') : options.publicKey;
    this.peers = options.peers;

    try {
      const multiaddr = Multiaddr(options.address);
      const mOptions = multiaddr.toOptions();
      this.address = `${mOptions.transport}://${mOptions.host}:${mOptions.port}`;
      this.id = multiaddr.getPeerId();
      this.publicKey = hashUils.getHexFromIpfsHash(multiaddr.getPeerId());
    } catch (e) {
      this.address = options.address;
      this.id = hashUils.getIpfsHashFromHex(this.publicKey);
    }


    this.state = options.state || states.FOLLOWER;    // Our current state.
    this.leader = '';                               // Leader in our cluster.
    this.term = 0;                                  // Our current term.

    this._initialize(options);
  }

  _initialize (options) {
    let raft = this;

    raft.on('term change', function change () {
      console.log(`[${Date.now()}]clear vote by changed term`);
      raft.votes.for = null;
      raft.votes.granted = 0;
      raft.votes.shares = [];
      raft.votes.secret = null;
      raft.votes.started = null;
    });

    raft.on('state change', function change (state) {
      console.log(`[${Date.now()}]state changed[${this.index}]: ${_.invert(states)[state]}`);
      raft.heartbeat(states.LEADER === raft.state ? raft.beat : raft.timeout());
      raft.emit(Object.keys(states)[state].toLowerCase());
    });

    this.on('threshold', async () => {
      if (this.state === states.LEADER) {
        console.log(`[${Date.now()}]restarting vote by threshold[${this.index}]`);
        this.change({state: states.FOLLOWER, leader: ''});
        this.timers.clear('heartbeat');
        await Promise.delay(this.timeout());
        raft.actions.node.promote();
      }
    });

    raft.on('data', async (packet, write = () => {
    }) => {


      console.log(`[${Date.now()}]incoming packet type[${this.index}]: ${packet.type}`);

      //  let reply = await raft.actions.message.packet(messageTypes.ACK);
      let reply;

      if (!_.isObject(packet)) {
        let reason = 'Invalid packet received';
        raft.emit(messageTypes.ERROR, new Error(reason));
        let reply = await raft.actions.message.packet(messageTypes.ERROR, reason);
        return write(reply);
      }


      /*
            if (packet.type === messageTypes.APPEND && _.has(packet, 'data.secret')) {

              let includedShare = !!_.find(packet.data.shares, {share: this.votes.share});

              let token = secrets.hex2str(packet.data.secret);

              let verified = speakeasy.totp.verify({
                secret: this.networkSecret,
                token: token,
                step: this.election.max / 1000
              });

              if (!includedShare && !verified) {
                let reply = await raft.actions.message.packet(messageTypes.ERROR, 'wrong share provided (1)');
                return write(reply);
              }

              //todo add pub key validation


              let pubKeys = this.nodes.map(node => node.publicKey);
              pubKeys.push(this.publicKey);


              let notFoundKeys = _.chain(packet.data.shares)
                .reject(item => {
                  if (!_.get(item, 'signed.messageHash'))
                    return true;

                  const restoredPublicKey = EthUtil.ecrecover(
                    Buffer.from(item.signed.messageHash.replace('0x', ''), 'hex'),
                    parseInt(item.signed.v),
                    Buffer.from(item.signed.r.replace('0x', ''), 'hex'),
                    Buffer.from(item.signed.s.replace('0x', ''), 'hex')).toString('hex');
                  return pubKeys.includes(restoredPublicKey);
                })
                .size()
                .value();


              if (!this.quorum(pubKeys.length - notFoundKeys)) {
                let reply = await raft.actions.message.packet(messageTypes.ERROR, 'wrong share provided (2)');
                return write(reply);
              }


              let validatedShares = _.chain(packet.data.shares).filter(share => _.has(share, 'signed'))
                .map(share => share.share)
                .value();

              let comb = secrets.combine(validatedShares);
              if (comb !== packet.data.secret) {
                let reply = await raft.actions.message.packet(messageTypes.ERROR, 'not enough nodes voted for you');
                return write(reply);
              }

              if (packet.term > raft.term) {
                raft.change({
                  leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || raft.leader,
                  state: states.FOLLOWER,
                  term: packet.term
                });
              }

              if (packet.term < raft.term) {
                let reason = 'Stale term detected, received `' + packet.term + '` we are at ' + raft.term;
                raft.emit('error', new Error(reason));

                let reply = await raft.actions.message.packet(messageTypes.ERROR, reason);
                return write(reply);
              }


            }

      */

      if (states.LEADER === packet.state && packet.type === messageTypes.APPEND) {

        //packet.proof.index || packet.proof.shares

        if(!_.has(packet, 'proof.index') && !_.has(packet, 'proof.shares')){
          let reply = await raft.actions.message.packet(messageTypes.ERROR, 'validation failed');
          return write(reply);
        }


        let pubKeys = this.nodes.map(node => node.publicKey);
        pubKeys.push(this.publicKey);

/*        if (packet.proof.shares && !packet.last.index) {

          let validated = validateSecretUtil(
            this.networkSecret,
            this.election.max,
            pubKeys,
            packet.proof.secret,
            Date.now(),
            packet.proof.shares);

          if(!validated){
            let reply = await raft.actions.message.packet(messageTypes.ERROR, 'validation failed');
            return write(reply);
          }
        }*/


        if(packet.proof.index){

       //   console.log(packet.data);
       //   console.log(packet.proof)
          let {index} = await this.log.getLastInfo();
  //        console.log(packet.proof.index, index)

    //      console.log(packet.proof)

          let proofEntry = await this.log.get(packet.proof.index);

/*          console.log(proofEntry)

          console.log(packet)

          process.exit(0)*/

/*if(proofEntry){
  console.log(proofEntry);
  process.exit(0)
}*/


          let validated = validateSecretUtil(
            this.networkSecret,
            this.election.max,
            pubKeys,
            packet.proof.proof.secret,
            _.get(proofEntry, 'createdAt', Date.now()),
            packet.proof.proof.shares);

          if(!validated){
            let reply = await raft.actions.message.packet(messageTypes.ERROR, 'validation failed');
            return write(reply);
          }

     /*     let fullProof = {
            shares: packet.proof.shares,
            secret: packet.proof.secret,
            index: _.get(packet, 'proof.index', packet.last.index),
            hash: _.get()
          };*/

          await this.log.addProof(packet.term, packet.proof)


        }


/*
        if (proofEntry) {
          console.log('--------after--------')
          console.log(proofEntry);
          process.exit(0)
        } else {
          console.log('------before-----')
          console.log(packet)
        }*/


        /*    console.log(proofEntry);

            console.log(packet.data)
            console.log(packet.proof)

            process.exit(0)*/

        /*        let includedShare = !!_.find(packet.data.shares, {share: this.votes.share});

                let token = secrets.hex2str(packet.data.secret);

                let verified = speakeasy.totp.verify({
                  secret: this.networkSecret,
                  token: token,
                  step: this.election.max / 1000
                });

                if (!includedShare && !verified) {
                  let reply = await raft.actions.message.packet(messageTypes.ERROR, 'wrong share provided (1)');
                  return write(reply);
                }

                //todo add pub key validation


                let pubKeys = this.nodes.map(node => node.publicKey);
                pubKeys.push(this.publicKey);


                let notFoundKeys = _.chain(packet.data.shares)
                  .reject(item => {
                    if (!_.get(item, 'signed.messageHash'))
                      return true;

                    const restoredPublicKey = EthUtil.ecrecover(
                      Buffer.from(item.signed.messageHash.replace('0x', ''), 'hex'),
                      parseInt(item.signed.v),
                      Buffer.from(item.signed.r.replace('0x', ''), 'hex'),
                      Buffer.from(item.signed.s.replace('0x', ''), 'hex')).toString('hex');
                    return pubKeys.includes(restoredPublicKey);
                  })
                  .size()
                  .value();


                if (!this.quorum(pubKeys.length - notFoundKeys)) {
                  let reply = await raft.actions.message.packet(messageTypes.ERROR, 'wrong share provided (2)');
                  return write(reply);
                }


                let validatedShares = _.chain(packet.data.shares).filter(share => _.has(share, 'signed'))
                  .map(share => share.share)
                  .value();

                let comb = secrets.combine(validatedShares);
                if (comb !== packet.data.secret) {
                  let reply = await raft.actions.message.packet(messageTypes.ERROR, 'not enough nodes voted for you');
                  return write(reply);
                }
                */


        //  if (packet.term > raft.term) {
        raft.change({
          leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || raft.leader,
          state: states.FOLLOWER,
          term: packet.term
        });
        //  }

        /*     if (packet.term < raft.term) {
               let reason = 'Stale term detected, received `' + packet.term + '` we are at ' + raft.term;
               raft.emit('error', new Error(reason));

               let reply = await raft.actions.message.packet(messageTypes.ERROR, reason);
               return write(reply);
             }*/
      }

      // if (packet.type !== messageTypes.VOTED) {
      raft.heartbeat(states.LEADER === raft.state ? raft.beat : raft.timeout());
      // }

      if (packet.type === messageTypes.VOTE) { //add rule - don't vote for node, until this node receive the right history (full history)
        await this.actions.vote.vote(packet, write);
      }

      if (packet.type === messageTypes.VOTED) {
        return await this.actions.vote.voted(packet, write);
      }

      if (packet.type === messageTypes.ERROR) {
        raft.emit(messageTypes.ERROR, new Error(packet.data));
      }


      if (packet.type === messageTypes.APPEND) {
        return await this.actions.append.append(packet, write); //move write
      }

      if (packet.type === messageTypes.APPEND_ACK) {
        await this.actions.append.appendAck(packet);
      }

      if (packet.type === messageTypes.APPEND_FAIL) {
        return await this.actions.append.appendFail(packet, write);
      }

      if (raft.listeners('rpc').length) {
        raft.emit('rpc', packet, write);
      } else {
        let reply = await raft.actions.message.packet('error', 'Unknown message type: ' + packet.type);
      }

      if (!reply)
        reply = await raft.actions.message.packet(messageTypes.ACK);

      // console.log(`reply type[${this.index}]: ${reply.type}`)
      write(reply);

    });


    if (states.CHILD === raft.state)
      return raft.emit('initialize');

    if (_.isFunction(raft.Log)) {
      raft.log = new raft.Log(raft, options);
    }


    function initialize (err) {
      if (err) return raft.emit(messageTypes.ERROR, err);

      raft.emit('initialize');
      // raft.heartbeat(raft.timeout());
      raft.heartbeat(_.random(0, raft.election.max));
    }

    if (_.isFunction(raft.initialize)) {
      if (raft.initialize.length === 2)
        return raft.initialize(options, initialize);
      raft.initialize(options);
    }

    initialize();
  }

  quorum (responses) {
    if (!this.nodes.length || !responses) return false;

    return responses >= this.majority();
  }

  majority () {
    return Math.ceil(this.nodes.length / 2) + 1;
  }

  heartbeat (duration) {
    let raft = this;

    duration = duration || raft.beat;

    if (raft.timers.active('heartbeat')) {
      raft.timers.adjust('heartbeat', duration);

      return raft;
    }

    raft.timers.setTimeout('heartbeat', async () => {

      //    return; //todo disabled heartbeat


      if (states.LEADER !== raft.state) {
        raft.emit('heartbeat timeout');

        console.log(`[${Date.now()}]promoting by timeout[${this.index}]`);
        return raft.actions.node.promote();
      }


      let packet = await raft.actions.message.packet(messageTypes.ACK);

      console.log(`[${Date.now()}]send append from heartbeat[${this.index}]: [${Date.now()}]`);

      raft.emit(messageTypes.ACK, packet);
      await raft.actions.message.message(states.FOLLOWER, packet, {ensure: false, timeout: this.election.max});
      raft.heartbeat(raft.beat);
    }, duration);

    return raft;
  }

  /**
   * Generate the various of timeouts.
   *
   * @returns {Number}
   * @private
   */
  timeout () {
    return Math.floor(Math.random() * (this.election.max - this.election.min + 1) + this.election.min);
  }

  /**
   * Create a clone of the current instance with the same configuration. Ideally
   * for creating connected nodes in a cluster.. And let that be something we're
   * planning on doing.
   *
   * @param {Object} options Configuration that should override the default config.
   * @returns {Raft} The newly created instance.
   * @public
   */
  clone (options) { //todo replace with lodash
    options = options || {};

    let raft = this,
      node = {
        Log: raft.Log,
        election_max: raft.election.max,
        election_min: raft.election.min,
        heartbeat: raft.beat,
        threshold: raft.threshold
      }, key;

    for (key in node) {
      if (key in options || !node.hasOwnProperty(key)) continue;

      options[key] = node[key];
    }

    return new raft.constructor(options);
  }


  /**
   * commitEntries - Commites entries in log and emits commited entries
   *
   * @param {Entry[]} entries Entries to commit
   * @return {Promise<void>}
   */
  async commitEntries (entries) {
    entries.forEach(async (entry) => {
      await this.log.commit(entry.index);
      this.emit(messageTypes.COMMIT, entry.command);
    });
  }
}


module.exports = Mokka;
