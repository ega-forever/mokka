const states = require('../factories/stateFactory'),
  Promise = require('bluebird'),
  eventTypes = require('../factories/eventFactory'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.api'}),
  _ = require('lodash');

const propose = async function (task) {

  if (this.state !== states.LEADER) {
    const {index, createdAt} = await this.log.getLastEntry();

    if (Date.now() - createdAt < this.election.max && index !== 0) {
      this.heartbeat(this.election.max);
      await Promise.delay(this.election.max - (Date.now() - createdAt));
      log.info('going to await for the current leader');
      return await propose.call(this, task);
    }


    log.info('promoting by propose');
    await this.actions.node.promote(2); //todo decide about promote

    this.timers.clear('heartbeat');
    await new Promise(res => this.once(eventTypes.LEADER, res)).timeout(this.election.max).catch(() => {
    });
    this.heartbeat(this.timeout());

    if (this.state !== states.LEADER) {
      log.info('trying to propose task again');
      let timeout = this.timeout();
      this.heartbeat(timeout * 2);
      await Promise.delay(_.random(0, timeout));

      return await propose.call(this, task);
    }
  }

  const entry = await this.log.saveCommand({task: task}, this.term);
  const appendPacket = await this.actions.message.appendPacket(entry);


  let followersAmount = _.chain(this.nodes).filter(node => node.state === states.FOLLOWER).size().value();

  let options = {
    ensure: true,
    serial: true,
    timeout: this.beat,
    minConfirmations: Math.ceil(followersAmount / 2) + 1
  };

  await this.actions.message.message(states.FOLLOWER, appendPacket, options);
  return entry;
};

module.exports = (instance) => {

  _.set(instance, 'api', {
    propose: propose.bind(instance)
  });

};