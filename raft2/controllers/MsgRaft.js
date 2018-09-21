const debug = require('diagnostics')('raft'),
  LifeRaft = require('../raft'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
  Web3 = require('web3'),
  web3 = new Web3(),
  EthUtil = require('ethereumjs-util'),
  crypto = require('crypto'),
  msg = require('axon');

class MsgRaft extends LifeRaft {

  /**
   * Initialized, start connecting all the things.
   *
   * @param {Object} options Options.
   * @api private
   */
  initialize (options) {
    debug('initializing reply socket on port %s', this.address);

    const socket = this.socket = msg.socket('rep');

    socket.bind(this.address);
    socket.on('message', (data, fn) => {

      if (data.type === 'task_vote')
        this.voteTask(data.data.taskId, data.data.share);

      if (data.type === 'task_voted')
        this.votedTask(data.data.taskId, data.data.payload, data.address);

      this.emit('data', data, fn);
    });

    socket.on('error', () => {
      debug('failed to initialize on port: ', this.address);
    });
  }

  /**
   * The message to write.
   *
   * @param {Object} packet The packet to write to the connection.
   * @param {Function} fn Completion callback.
   * @api private
   */
  write (packet, fn) {
    if (!this.socket) {
      this.socket = msg.socket('req');

      this.socket.connect(this.address);
      this.socket.on('error', function err () {
        console.error('failed to write to: ', this.address);
      });
    }

    debug('writing packet to socket on port %s', this.address);
    this.socket.send(packet, (data) => {
      fn(undefined, data);
    });
  }

  async proposeTask (task) {
    await this.promote();
    await new Promise(res => this.once('leader', res));
    return await this.command({task: task});
  }

  async executeTask (taskId) {

    let addresses = _.chain(this.nodes)
      .filter(node => [MsgRaft.FOLLOWER, MsgRaft.CHILD].includes(node.state))
      .map(node => node.address).value();

    let minValidates = Math.round(addresses.length / 2);

    if (minValidates === 1)
      minValidates = Object.keys(this.peers).length;

    let task = await this.log.db.get(taskId);
    task = task.command.task;
    let id = crypto.createHash('md5').update(JSON.stringify(task)).digest('hex');
    let shares = secrets.share(id, addresses.length, minValidates);

    await this.log.setMinShare(taskId, minValidates);

    for (let index = 0; index < addresses.length; index++) {
      let packet = await this.packet('task_vote', {taskId: taskId, share: shares[index]});
      await this.message(addresses[index], packet);
    }


  }

  async voteTask (taskId, share) {

    let task = await this.log.db.get(taskId);
    if (!task)
      return;

    const signedShare = web3.eth.accounts.sign(share, `0x${this.privateKey}`);
    let packet = await this.packet('task_voted', {taskId: taskId, payload: signedShare});
    await this.message(MsgRaft.LEADER, packet);
  }

  async votedTask (taskId, payload, peer) {

    const publicKey = EthUtil.ecrecover(Buffer.from(payload.messageHash.replace('0x', ''), 'hex'), parseInt(payload.v), Buffer.from(payload.r.replace('0x', ''), 'hex'), Buffer.from(payload.s.replace('0x', ''), 'hex'));

    if (!this.peers.includes(publicKey.toString('hex')))
      return;

    let entry = await this.log.appendShare(taskId, payload.message, peer);

    if(entry.minShares > entry.shares.length)
      return;

    let shares = entry.shares.map(item=>item.share);

    let id = crypto.createHash('md5').update(JSON.stringify(entry.command.task)).digest('hex');
    let comb = secrets.combine(shares);

    if(comb !== id)
      return; //todo remove task

    const signedId = web3.eth.accounts.sign(id, `0x${this.privateKey}`);
    let packet = await this.packet('task_executed', {taskId: taskId, signature: signedId});
    await this.message();

  }

  async executedTask(taskId, payload, peer){

    const publicKey = EthUtil.ecrecover(Buffer.from(payload.messageHash.replace('0x', ''), 'hex'), parseInt(payload.v), Buffer.from(payload.r.replace('0x', ''), 'hex'), Buffer.from(payload.s.replace('0x', ''), 'hex'));

    if (!this.peers.includes(publicKey.toString('hex')))
      return;



  }

}

module.exports = MsgRaft;
