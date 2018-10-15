const states = require('../factories/stateFactory'),
  Promise = require('bluebird'),
  eventTypes = require('../factories/eventFactory'),
  _ = require('lodash');

const propose = async function (task, delay = true) {

  let {createdAt, index, owner} = await this.log.getLastEntry();

  if(Date.now() - createdAt < this.election.max && index !== 0 && owner !== this.publicKey){
    console.log(`await for state from another node before promote:[${this.index}]`)
    await Promise.delay(Date.now() - createdAt);
    return await propose.call(this, task);
  }


  if (this.state !== states.LEADER) {
    //await Promise.delay(this.election.max);
    if(delay)
      await Promise.delay(_.random(this.election.min, this.election.max));

    await this.actions.node.promote(2); //todo decide about promote

    await new Promise(res => this.once(eventTypes.LEADER, res)).timeout(this.election.max).catch(() => {});

    if (this.state !== states.LEADER)
      return await propose.call(this, task);
  }

  const entry = await this.log.saveCommand({task: task}, this.term);

  const appendPacket = await this.actions.message.appendPacket(entry);

  let options = {
    ensure: true,
    serial: true
  };

  //this.timeout;
  this.heartbeat(this.beat);
  await this.actions.message.message(states.FOLLOWER, appendPacket, options);
  // this.actions.message.message(states.FOLLOWER, appendPacket);
  return entry;
};

module.exports = (instance) => {

  _.set(instance, 'api', {
    propose: propose.bind(instance)
  });

};