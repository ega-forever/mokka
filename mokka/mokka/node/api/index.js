const states = require('../factories/stateFactory'),
  Promise = require('bluebird'),
  eventTypes = require('../factories/eventFactory'),
  _ = require('lodash');

const propose = async function (task) {

  if (this.state !== states.LEADER) {
      const {index, createdAt} = await this.log.getLastEntry();

  if (Date.now() - createdAt < this.election.max && index !== 0) {
    this.timers.clear('heartbeat');
    await Promise.delay(this.election.max - (Date.now() - createdAt));
    console.log(`going to await[${this.index}], leader: ${this.leader}`)
    this.heartbeat(this.timeout());
    return await propose.call(this, task);
  }



    await this.actions.node.promote(2); //todo decide about promote

    this.timers.clear('heartbeat');
    await new Promise(res => this.once(eventTypes.LEADER, res)).timeout(this.election.max).catch(() => {});
    this.heartbeat(this.timeout());

    if (this.state !== states.LEADER)
      return await propose.call(this, task);
  }

  const entry = await this.log.saveCommand({task: task}, this.term);
  const appendPacket = await this.actions.message.appendPacket(entry);

/*
  let options = {
    ensure: true,
    serial: true
  };
*/


  let options = {
    ensure: true,
    serial: true
  };

  //this.timeout;
 // this.timers.clear('heartbeat');
  await this.actions.message.message(states.FOLLOWER, appendPacket, options);
 // this.heartbeat(this.timeout());
  // this.actions.message.message(states.FOLLOWER, appendPacket);
  return entry;
};

module.exports = (instance) => {

  _.set(instance, 'api', {
    propose: propose.bind(instance)
  });

};