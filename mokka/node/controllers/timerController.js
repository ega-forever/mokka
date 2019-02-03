const Tick = require('tick-tock'),
  _ = require('lodash'),
  states = require('../factories/stateFactory'),
  messageTypes = require('../factories/messageTypesFactory');


class TimerController {

  constructor (mokka) {
    this.mokka = mokka;
    this.timers = new Tick(this);
  }



  heartbeat (duration) {

    duration = duration || this.mokka.beat;

    if (this.timers.active('heartbeat') && this.mokka.state !== states.LEADER) {
      this.timers.adjust('heartbeat', duration);
      return this.mokka;
    }

    if (this.timers.active('heartbeat'))
      this.timers.clear('heartbeat');


    this.timers.setTimeout('heartbeat', async () => {

      if (states.LEADER !== this.mokka.state) {
        //if pendings - the miss
        let pending = await this.mokka.log.pending.getFirst();

        if (pending.hash)
          return;

        this.mokka.emit('heartbeat timeout');//todo move to eventTypes

        this.mokka.logger.trace('promoting by timeout');
        return this.mokka.actions.node.promote();
      }


      let packet = await this.mokka.actions.message.packet(messageTypes.ACK);

      this.mokka.logger.trace('send append request by timeout');
      await this.mokka.actions.message.message(states.FOLLOWER, packet);
      this.mokka.time.heartbeat(this.mokka.beat);
    }, duration);

    return this.mokka;
  }


  timeout () {
    //return _.random(this.beat, parseInt(this.beat * 1.5)); //todo use latency
    return _.random(this.mokka.beat, parseInt(this.mokka.beat * 1.5)) + 200;
  }



}


module.exports = TimerController;
