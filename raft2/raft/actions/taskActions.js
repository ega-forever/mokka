const states = require('../factories/stateFactory'),
  crypto = require('crypto'),
  secrets = require('secrets.js-grempe'),
  Promise = require('bluebird'),
  _ = require('lodash'),
  Web3 = require('web3'),
  web3 = new Web3(),
  EthUtil = require('ethereumjs-util');

const propose = async function (task) {

  if (this.state !== states.LEADER) {
    await Promise.delay(this.election.max);
    await this.actions.node.promote(); //todo decide about promote

    await new Promise(res => this.once('leader', res)).timeout(this.election.max).catch(() => {
    });

    if (this.state !== states.LEADER)
      return await this.actions.tasks.propose(task);
  }

  const entry = await this.log.saveCommand({task: task}, this.term);
  const appendPacket = await this.actions.message.appendPacket(entry);
  this.actions.message.message(states.FOLLOWER, appendPacket);
  return entry;
};

const reserve = async function (taskId, waitForQuorum = true) {
  if (this.state !== states.LEADER) {
    await Promise.delay(this.election.max);
    await this.actions.node.promote(); //todo decide about promote

    await new Promise(res => this.once('leader', res)).timeout(this.election.max).catch(() => {
    });

    if (this.state !== states.LEADER)
      return await this.actions.tasks.reserve(taskId);
  }

  let timeout = 1000 * 60 * 5; //5 min //todo calculate (predict the difficulty of task)
  const entry = await this.log.saveCommand({reserve: taskId, timeout: timeout}, this.term);
  const appendPacket = await this.actions.message.appendPacket(entry);
  this.actions.message.message(states.FOLLOWER, appendPacket);


  if (waitForQuorum)
    await new Promise(res => {
      const eventCallBack = async (index) => {
        if (index !== entry.index)
          return;

        const item = await this.log.get(entry.index);

        if (item.responses.length < this.majority())
          return;

        this.removeListener('append_ack', eventCallBack);
        res();
      };

      this.on('append_ack', eventCallBack);
    }).timeout(this.election.max * 2).catch(() => {
      return Promise.reject({code: 0, message: `quorum hasn't been reached for task ${taskId}`});
    });


  return entry;
};

const execute = async function (taskId) {

  if (!(await this.log.isReserved(taskId)))
    return Promise.reject({code: 0, message: 'task is not reserved!'});

  let addresses = _.chain(this.nodes)
    .filter(node => [states.FOLLOWER, states.CHILD].includes(node.state))
    .map(node => node.address).value();

  let minValidates = Math.round(addresses.length / 2);

  if (minValidates === 1)
    minValidates = Object.keys(this.peers).length;

  let taskSuper = await this.log.get(taskId);
  let task = taskSuper.command.task;

  if (!task)
    return Promise.reject({code: 0, message: 'task is not reserved!'});

  if (addresses.length < 2)
    return await this.actions.tasks.executed(taskId); //skip vote as no node for vote available

  let id = crypto.createHash('md5').update(JSON.stringify(task)).digest('hex');
  let shares = secrets.share(id, addresses.length, minValidates);

  await this.log.setMinShare(taskId, minValidates);//todo set lock on tasks

  for (let index = 0; index < addresses.length; index++) {
    let packet = await this.actions.message.packet('task_vote', {taskId: taskId, share: shares[index]});
    await this.actions.message.message(addresses[index], packet);
  }


  //todo await for voting

  let voteCallback = (res, mintedTaskId) => {
    if (taskId === mintedTaskId)
      res();
  };

  await new Promise((res) => {
    this.once('task_voted', voteCallback.bind(this, res));
  }).timeout(this.election.max * 2).catch(() => {
    this.removeListener('task_voted', voteCallback);
    return Promise.reject({code: 0, message: 'vote timeout'})
  });


};

const vote = async function (taskId, share, peer, term) {

  if (term > this.term) {
    await Promise.delay(this.election.max);
    return await this.actions.tasks.vote(taskId, share, peer, term);
  }

  let isTaskExist = await this.log.has(taskId);
  if (!isTaskExist)
    return;

  const signedShare = web3.eth.accounts.sign(share, `0x${this.privateKey}`);
  let packet = await this.actions.message.packet('task_voted', {taskId: taskId, payload: signedShare});
  await this.actions.message.message(peer, packet);
};

const voted = async function (taskId, payload, peer) {

  const publicKey = EthUtil.ecrecover(Buffer.from(payload.messageHash.replace('0x', ''), 'hex'), parseInt(payload.v), Buffer.from(payload.r.replace('0x', ''), 'hex'), Buffer.from(payload.s.replace('0x', ''), 'hex'));

  if (!this.peers.includes(publicKey.toString('hex')))
    return;


  let entry = await this.log.appendShare(taskId, payload.message, peer);


  if (entry.minShares > entry.shares.length)
    return;

  let shares = entry.shares.map(item => item.share);

  let id = crypto.createHash('md5').update(JSON.stringify(entry.command.task)).digest('hex');
  let comb = secrets.combine(shares);

  if (comb !== id)
    return; //todo remove task


  if (entry.minShares === entry.shares.length)
    await this.actions.tasks.executed(taskId);
};

const executed = async function (taskId) {

  if (this.state !== states.LEADER) {
    await Promise.delay(this.election.max);
    await this.actions.node.promote(); //todo decide about promote

    await new Promise(res => this.once('leader', res)).timeout(this.election.max).catch(() => null);

    if (this.state !== states.LEADER)
      return await this.actions.tasks.executed(taskId);
  }

  const executedEntry = await this.log.saveCommand({executed: taskId}, this.term);
  const appendPacket = await this.actions.message.appendPacket(executedEntry);
  this.actions.message.message(states.FOLLOWER, appendPacket);
  return executedEntry;
};

module.exports = (instance) => {

  _.set(instance, 'actions.tasks', {
    propose: propose.bind(instance),
    reserve: reserve.bind(instance),
    execute: execute.bind(instance),
    vote: vote.bind(instance),
    voted: voted.bind(instance),
    executed: executed.bind(instance)
  });

};
