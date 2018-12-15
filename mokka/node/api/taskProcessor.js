const Promise = require('bluebird'),
  semaphore = require('semaphore'),
  states = require('../factories/stateFactory'),
  eventTypes = require('../factories/eventFactory'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.api'}),
  _ = require('lodash');

class TaskProcessor {

  constructor (mokka) {
    this.semPending = semaphore(1);
    this.sem = semaphore(1);
    this.mokka = mokka;
    this.run = 1;

  }

  async push (task) {
    return await new Promise(res =>
      this.semPending.take(async () => {
        await this.mokka.log.putPending(task);
        this.semPending.leave();
        res();
      })
    );


  }


  async runLoop () { //loop for checking new packets
    while (this.run) {


      if(!this.sem.available()){
        await Promise.delay(this.mokka.timeout());
        continue;
      }

      let lastEntry = await this.mokka.log.getLastEntry();//todo

      if (lastEntry.index > 0 && lastEntry.owner === this.mokka.publicKey) {

        let followers = _.chain(this.mokka.nodes)
          .reject(node => _.find(lastEntry.responses, {publicKey: node.publicKey}))
          .value();

        const minConfirmations = Math.floor(followers.length / 2) + 1;

        if (lastEntry.responses.length - 1 < minConfirmations) {
          await Promise.delay(this.mokka.timeout());
          continue;
        }
      }


      let pending = await this.mokka.log.getFirstPending();
      if (!pending.hash) {
        await Promise.delay(this.mokka.timeout()); //todo delay for next tick or event on new push
        continue;
      }


      await this._commit(pending.command, pending.hash);
      log.info(`pulling pending task ${pending.command} with hash ${pending.hash}`);
      await this.mokka.log.pullPending(pending.hash);
    }


  }

  async _commit (task, hash) {

    return await new Promise(res =>
      this.sem.take(async () => {

        if (this.mokka.state !== states.LEADER)
          await this._lock();

        //todo check here the pending task is still exist!!

        let checkPending = await this.mokka.log.getPending(hash);

        if(!checkPending){
          this.sem.leave();
          return res();
        }

        let entry = await this._save(task);
        await this._broadcast(entry.index, entry.hash);
        log.info(`task has been broadcasted ${task}`);

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
      let timeout = this.mokka.timeout();//todo test max skip rounds for voting
      const {createdAt} = await this.mokka.log.getLastInfo(); //todo replace with blacklist response
      const delta = Date.now() - createdAt;

      if (delta < this.mokka.election.max)
        timeout += delta;

      this.mokka.heartbeat(timeout);
      await Promise.delay(timeout);
      return await this._lock();
    }

  }

  async _save (task) {
    return await this.mokka.log.saveCommand({task: task}, this.mokka.term);
  }

  async _broadcast (index, hash) {

    let entry = await this.mokka.log.get(index);

    if (!entry || entry.hash !== hash)
      return log.info(`can't broadcast entry at index ${index}`);

    log.info(`broadcasting task ${entry.command.task} at index ${index}`);

    if (entry.term !== this.mokka.term || this.mokka.state !== states.LEADER)
      return entry;

    let followers = _.chain(this.mokka.nodes)
    // .filter(node => node.state === states.FOLLOWER) //todo add event when all nodes move from child->follower
      .reject(node => _.find(entry.responses, {publicKey: node.publicKey}))
      .value();

    if (followers.length === 0)
      return entry;

    const appendPacket = await this.mokka.actions.message.appendPacket(entry);
    let pubKeys = followers.map(node => node.publicKey);

    await this.mokka.actions.message.message(pubKeys, appendPacket);

  }

}

module.exports = TaskProcessor;
