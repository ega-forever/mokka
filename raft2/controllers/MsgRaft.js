const debug = require('diagnostics')('raft'),
  LifeRaft = require('../raft'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
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

      if(data.type === 'task_vote')
         this.voteTask(data.data.taskId, data.data.share);

      if(data.type === 'task_voted')
        this.votedTask(data.data.task, data.data.payload, data.address);

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

  async proposeTask (task){
    await this.promote();
    console.log('propose command');
    await new Promise(res=> this.once('leader', res));
    return await this.command({task: task});
  }

  async executeTask(taskId){

    let addresses = _.chain(this.nodes).filter(node=>node.state === MsgRaft.FOLLOWER).map(node=>node.address).value();

    let minValidates = Math.round(addresses.length / 2);

    if (minValidates === 1)
      minValidates = Object.keys(this.peers).length;


    let task = await this.log.db.get(taskId);
    task = task.command.task;
    let id = crypto.createHash('md5').update(JSON.stringify(task)).digest('hex');
    let shares = secrets.share(id, addresses.length, minValidates);

    for(let index = 0;index < addresses.length;index++){
       let packet = await this.packet('task_vote', {taskId: taskId, share: shares[index]});
      await this.message(addresses[index], packet);
    }

  }

  async voteTask(taskId, share){

    console.log(taskId, share)
    return;

    let task = await this.log.db.get(taskId);
    task = task.command.task;
    let id = crypto.createHash('md5').update(JSON.stringify(task)).digest('hex');

    let packet = await this.packet('task_voted', {task: taskId, payload: 'payload'});
    await this.message(MsgRaft.LEADER, packet);
  }

  async votedTask(taskId, payload, peer){

    console.log('peer voted: ', taskId, payload, peer)

  }

}

module.exports = MsgRaft;
