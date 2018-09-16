const crypto = require('crypto'),
  Swarm = require('discovery-swarm'),
  defaults = require('dat-swarm-defaults'),
  getPort = require('get-port'),
  secrets = require('secrets.js-grempe'),
  Promise = require('bluebird'),
  Wallet = require('ethereumjs-wallet'),
  sem = require('semaphore')(1),
  EthUtil = require('ethereumjs-util'),
  _ = require('lodash'),
  Web3 = require('web3'),
  jd = require('json-delta'),
  web3 = new Web3(),
  EventEmitter = require('events');

const states = {
  VOTE: 'vote',
  ACCEPTED: 'accepted',
  PROPOSE: 'propose',
  OBTAIN: 'obtain',
  STAGE: 'stage',
  STATE: 'state',
  TASK: 'task'
};

class P2pController extends EventEmitter {

  constructor (privKey, peerPubKeys) {
    super();
    this.privKey = privKey;
    this.peerPubKeys = peerPubKeys;
    this.pubKey = Wallet.fromPrivateKey(Buffer.from(this.privKey, 'hex')).getPublicKey().toString('hex');
    this.peers = {};
    this.config = defaults({id: Buffer.from(this.pubKey, 'hex')});
    this.swarm = Swarm(this.config);
    this.tasks = [];
    this.checkpointMap = {
      [crypto.createHash('md5').update(JSON.stringify([])).digest('hex')]: [] //delta
    };
    this.connectionsHandled = 0;
  }


  async start () {

    const port = await getPort();
    this.swarm.listen(port);
    console.log(`client started on port ${port}`);
    this.swarm.join('tasks');

    this.swarm.on('connection', (conn, info) => {

      const peerId = info.id.toString('hex');

      if (this.peerPubKeys.indexOf(peerId) === -1)
        return;

      console.log(`Connected to peer: ${peerId}`);

      // Keep alive TCP connection with peer
      if (info.initiator) {
        try {
          conn.setKeepAlive(true, 600)
        } catch (exception) {
          console.log('exception', exception)
        }
      }

      conn.on('data', data => {

        data = JSON.parse(data.toString());

        if (data.task === states.OBTAIN)
          return this._broadcastState(peerId, data.checkpoint);

        if (data.task === states.STATE)
          return this._push(data.payload, peerId, true);

        if (data.task === states.PROPOSE)
          return this._vote(data.id, data.share, peerId);

        if (data.task === states.VOTE)
          return this._voted(data.id, data.payload, peerId);

        if (data.task === states.ACCEPTED)
          return this._pull(data.id, data.payload, peerId);

      });

      conn.on('close', () => {
        console.log(`Connection closed, peer id: ${peerId}`);
        if (this.peers[peerId].seq === this.connectionsHandled)
          delete this.peers[peerId];
      });


      this.peers[peerId] = {conn: conn, seq: this.connectionsHandled};
      this.connectionsHandled++;

      const currentCheckpoint = _.last(Object.keys(this.checkpointMap));

      this._execute(JSON.stringify({task: states.OBTAIN, checkpoint: currentCheckpoint}), [peerId]);
    });
  }

  add (task) {

    let oldTasks = _.cloneDeep(this.tasks);
    this.tasks.push(task);
    let delta = jd.diff(oldTasks, this.tasks);
    let checkpoint = crypto.createHash('md5').update(JSON.stringify(delta)).digest('hex');
    this.checkpointMap[checkpoint] = delta;

    const ids = Object.keys(this.peers);

    for (let id of ids)
      this._broadcastState(id, checkpoint)


  }

  async propose (id) {

    let pwHex = secrets.str2hex(id); // => hex string

    let minValidates = Math.round(Object.keys(this.peers).length / 2);

    if (minValidates === 1)
      minValidates = Object.keys(this.peers).length;

    let shares = secrets.share(pwHex, Object.keys(this.peers).length, minValidates);

    const ids = Object.keys(this.peers);

    for (let index = 0; index < ids.length; index++) {
      let data = JSON.stringify({
        task: states.PROPOSE,
        share: shares[index],
        id: id
      });

      this._execute(data, [ids[index]]);
    }

    let task = _.find(this.tasks, {id: id});
    task.locked = true;
    task.proposer = this.pubKey;
    task.shares = shares;
    task.minShares = minValidates;
  }

  async _broadcastState (peerId, checkpoint) {

    let deltas = _.chain(this.checkpointMap).toPairs().map(pair => ({
      delta: pair[1],
      checkpoint: pair[0]
    })).value();

    let currentIndex = _.findIndex(deltas, {checkpoint: checkpoint});

    deltas = _.drop(deltas, currentIndex + 1);

    deltas = _.transform(deltas, (result, item) => result.push(item.delta), []);

    this._execute(JSON.stringify({task: states.STATE, payload: deltas}), [peerId]);
  }

  async _vote (taskId, share, peerId) {
    const signedShare = web3.eth.accounts.sign(share, `0x${this.privKey}`);
    const task = _.find(this.tasks, {id: taskId});

    if (!task)
      return;

    task.proposer = peerId;
    this._execute(JSON.stringify({task: states.VOTE, payload: signedShare, id: taskId}), [peerId]);
  }

  async _voted (taskId, vote, peerId) {

    let task = _.find(this.tasks, {id: taskId});
    if (!task.confirmedShares)
      task.confirmedShares = [];

    const publicKey = EthUtil.ecrecover(Buffer.from(vote.messageHash.replace('0x', ''), 'hex'), parseInt(vote.v), Buffer.from(vote.r.replace('0x', ''), 'hex'), Buffer.from(vote.s.replace('0x', ''), 'hex'));

    if (peerId !== publicKey.toString('hex'))
      return;

    task.confirmedShares.push(peerId);

    if (task.confirmedShares.length < task.minShares)
      return;

    _.pull(this.tasks, task);

    const singed = web3.eth.accounts.sign(task.data, `0x${this.privKey}`);

    for (let id in this.peers)
      this._execute(JSON.stringify({task: states.ACCEPTED, payload: singed, id: taskId}), [id]);

    this.emit('task_pulled', taskId);

  }

  _push (deltas, peerId, sync = true) {

    for (let delta of deltas) {
      let checkpoint = crypto.createHash('md5').update(JSON.stringify(delta)).digest('hex');

      if (this.checkpointMap[checkpoint])
        return console.log(`already synced with ${peerId}`);

      if (delta.length > 0) {
        this.checkpointMap[checkpoint] = delta;

        this.tasks = jd.applyDiff(this.tasks, delta);

      }
    }

    /*    this.checkpoint.peers++;

        if(this.checkpoint.peers === Object.keys(this.peers).length){
          this.emit('synced');
        }*/

  }

  _pull (id, payload, peerId) {

    let task = _.find(this.tasks, {id: id, proposer: peerId});

    if (!task)
      return;

    const publicKey = EthUtil.ecrecover(Buffer.from(payload.messageHash.replace('0x', ''), 'hex'), parseInt(payload.v), Buffer.from(payload.r.replace('0x', ''), 'hex'), Buffer.from(payload.s.replace('0x', ''), 'hex'));

    if (peerId !== publicKey.toString('hex'))
      return;

    _.pull(this.tasks, task);

    this.emit('task_pulled', id);

  }

  async _execute (data, peerIds = Object.keys(this.peers)) {

    if (_.isString(data))
      data = JSON.parse(data);

    if (Object.values(states).indexOf(data.task) === -1)
      return;

    sem.take(async () => {

      for (let peerId of peerIds)
        if (this.peers[peerId])
          this.peers[peerId].conn.write(JSON.stringify(data));

      await Promise.delay(500);
      sem.leave();
    });


  }


}


module.exports = P2pController;
