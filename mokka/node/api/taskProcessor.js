const Promise = require('bluebird'),
  semaphore = require('semaphore'),
  states = require('../factories/stateFactory'),
  eventTypes = require('../factories/eventFactory'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.api'}),
  _ = require('lodash');

class TaskProcessor {

  constructor (mokka) {
    this.sem = semaphore(1);
    this.mokka = mokka;
  }


  async push (task) {

    return await new Promise(res =>
      this.sem.take(async () => {

        if (this.mokka.state !== states.LEADER)
          await this._lock();

        let entry = await this._save(task);
        await this._broadcast(entry.index);

        this.sem.leave();
        res(entry);
      })
    );

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

  async _broadcast (index) {

    log.info(`broadcasting ${index}`);
    let entry = await this.mokka.log.get(index);

    //  if(_.find(this.mokka.nodes, {state: states.CHILD}))
    //    throw Error('child detected');

    if(!entry)
      return;

    if (entry.term !== this.mokka.term || this.mokka.state !== states.LEADER)
      return entry;

    let followers = _.chain(this.mokka.nodes)
    // .filter(node => node.state === states.FOLLOWER) //todo add event when all nodes move from child->follower
      .reject(node => _.find(entry.responses, {publicKey: node.publicKey}))
      .value();

    if (followers.length === 0)
      return entry;

    let options = {
      timeout: this.mokka.beat,
      minConfirmations: Math.floor(followers.length / 2) + 1
    };

    console.log('check', followers.length, Math.floor(followers.length / 2) + 1);

    const appendPacket = await this.mokka.actions.message.appendPacket(entry);
    let pubKeys = followers.map(node=>node.publicKey);

    try {
      await this.mokka.actions.message.message(pubKeys, appendPacket, options);
    } catch (e) {
      return await this._broadcast(index);
    }

  }

}

module.exports = TaskProcessor;
