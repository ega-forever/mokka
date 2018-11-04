const Kyoo = require('kyoo'),
  Promise = require('bluebird'),
  states = require('../factories/stateFactory'),
  eventTypes = require('../factories/eventFactory'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.api'}),
  _ = require('lodash');

class TaskProcessor {

  constructor (mokka) {

    this.q = new Kyoo({autostart: true, concurrency: 1});
    this.mokka = mokka;

  }


  async push (task) {

    let createJob = async (cb) => {

      try {
        if (this.mokka.state !== states.LEADER) {
          await this._lock();
        }

        let entry = await this._save(task);
        cb(null, entry);
      } catch (e) {
        cb(e);
      }
    };

    let entry = await this._createJob(createJob);

    let broadcastJob = async (cb) => {
      try {
        await this._broadcastTask(entry.index);
        cb(null, entry);
      } catch (e) {
        cb(e);
      }
    };

    await this._createJob(broadcastJob, true);
    return entry;
  }

  async _createJob (job, next = false) {

    next ?
      this.q.unshift(job) :
    this.q.push(job);

    return await new Promise((res) => {

      const successCallback = (result, executedJob) => {

        if (job !== executedJob)
          return;

        this.q.removeListener('success', successCallback);
        res(result);
      };

      const errorCallback = async (err, executedJob) => {

        if (job !== executedJob)
          return;

        this.q.removeListener('error', errorCallback);

   //     let result = await this._createJob(job, true);
   //     res(result);
        //todo appoint broadcast task
      };

      this.q.on('success', successCallback);
      this.q.on('error', errorCallback);
    });
  }


  async _lock () {

    const {index, createdAt} = await this.mokka.log.getLastEntry();

    if (Date.now() - createdAt < this.mokka.election.max && index !== 0) {
      this.mokka.heartbeat(this.mokka.election.max);
      await Promise.delay(this.mokka.election.max - (Date.now() - createdAt));
      log.info('going to await for the current leader');
      return await this._lock();
    }


    log.info('promoting by propose');
    await this.mokka.actions.node.promote(2); //todo decide about promote

    this.mokka.timers.clear('heartbeat');
    await new Promise(res => this.mokka.once(eventTypes.LEADER, res)).timeout(this.mokka.election.max).catch(() => {
    });
    this.mokka.heartbeat(this.mokka.timeout());

    if (this.mokka.state !== states.LEADER) {
      log.info('trying to propose task again');
      let timeout = this.mokka.timeout();
      this.mokka.heartbeat(timeout * 2);
      await Promise.delay(_.random(0, timeout));
      return await this._lock();
    }

  }

  async _save (task) {
    return await this.mokka.log.saveCommand({task: task}, this.mokka.term);
  }

  async _broadcastTask (index) {

    let entry = await this.mokka.log.get(index);

    if(_.find(this.mokka.nodes, {state: states.CHILD}))
      throw Error('child detected');


    if (entry.term !== this.mokka.term || this.mokka.state !== states.LEADER)
      return entry;

    let followersAmount = _.chain(this.mokka.nodes)
      .filter(node => node.state === states.FOLLOWER)
      .reject(node => _.find(entry.responses, {publicKey: node.publicKey}))
      .size().value();

    if (followersAmount === 0) {
     console.log('no followers!');
     console.log(entry);
     console.log(this.mokka.nodes.map(node=>node.state))
     process.exit(0);
      return entry;
    }

    let options = {
      timeout: this.mokka.beat,
      minConfirmations: followersAmount === 1 ? 1 : Math.ceil(followersAmount / 2) + 1
    };

    const appendPacket = await this.mokka.actions.message.appendPacket(entry);
    await this.mokka.actions.message.message(states.FOLLOWER, appendPacket, options);
  }

}

module.exports = TaskProcessor;