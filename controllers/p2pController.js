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
  web3 = new Web3(),
  EventEmitter = require('events');

const states = {
  VOTE: 'vote',
  ACCEPTED: 'accepted',
  PROPOSE: 'propose',
  OBTAIN: 'obtain',
  STATE: 'state'
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
    this.synced = false;
    this.checkpoint = {//make checkpoint null on vote
      state: null,
      peers: 0
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
          return this._broadcastState(peerId);

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

      this._execute(JSON.stringify({task: states.OBTAIN}), [peerId]);
    });

  }

  setState (tasks) {
    this.synced = true;
    _.isArray(tasks) ?
      this.tasks.push(...tasks) :
      this.tasks.push(tasks);
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

  async _broadcastState (peerId) {
    const tasks = this.tasks.map(task => _.pick(task, ['id', 'data', 'locked', 'proposer']));
    this._execute(JSON.stringify({task: states.STATE, payload: tasks}), [peerId]);
  }

  async _vote (taskId, share, peerId) {
    const signedShare = web3.eth.accounts.sign(share, `0x${this.privKey}`);
    const task = _.find(this.tasks, {id: taskId});

    if(!task)
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

  _push (tasks, peerId, sync = true) {

    let checkpoint = crypto.createHash('md5').update(JSON.stringify(tasks)).digest('hex');

    console.log(checkpoint)

    if(this.checkpoint.state && this.checkpoint.state !== checkpoint)
      return console.log(`received wrong checkpoint from ${peerId}`);

    if(!this.checkpoint.state)
      this.checkpoint.state = checkpoint;

    if (!_.isArray(tasks)) //todo sync validation
      tasks = [tasks];

    for (let task of tasks)
      if (!_.find(this.tasks, {id: task.id}))
        this.tasks.push(task);

    this.checkpoint.peers++;

    if(this.checkpoint.peers === Object.keys(this.peers).length){
      this.synced = true;
      this.emit('synced');
    }

  }

  _pull (id, payload, peerId) {

    let task = _.find(this.tasks, {id: id, proposer: peerId});

    if(!task)
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

    if(Object.values(states).indexOf(data.task) === -1)
      return;

    if(states.OBTAIN !== data.task && !this.synced){
      await Promise.delay(1000);
      await this._execute(data, peerIds);
    }


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
