const states = require('../factories/stateFactory'),
  Promise = require('bluebird'),
  eventTypes = require('../factories/eventFactory'),
  _ = require('lodash');

const propose = async function (task) {

  if (this.state !== states.LEADER) {
    await Promise.delay(this.election.max);
    await this.actions.node.promote(); //todo decide about promote

    await new Promise(res => this.once(eventTypes.LEADER, res)).timeout(this.election.max).catch(() => {
    });

    if (this.state !== states.LEADER)
      return await propose.call(this, task);
  }

  const entry = await this.log.saveCommand({task: task}, this.term);
  const appendPacket = await this.actions.message.appendPacket(entry);
  this.actions.message.message(states.FOLLOWER, appendPacket);
  return entry;
};

module.exports = (instance) => {

  _.set(instance, 'api', {
    propose: propose.bind(instance)
  });

};