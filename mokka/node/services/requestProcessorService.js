const _ = require('lodash'),
  states = require('../factories/stateFactory'),
  messageTypes = require('../factories/messageTypesFactory'),
  ProofValidationService = require('./proofValidationService');


class RequestProcessor {

  constructor (mokka) {
    this.mokka = mokka;
    this.proofValidation = new ProofValidationService(mokka);
  }


  async process (packet) {

    let reply;

    if (!_.isObject(packet)) {
      let reason = 'Invalid packet received';
      this.mokka.emit(messageTypes.ERROR, new Error(reason));
      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, reason);
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    if (packet.type === messageTypes.APPEND) {

      if (!packet.proof) {

        let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
        return {
          reply: reply,
          who: packet.publicKey
        };
      }

      let validated = await this.proofValidation.validate(packet.term, packet.proof, packet.data); //todo fix

      if (!validated) {
        let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
        return {
          reply: reply,
          who: packet.publicKey
        };
      }

      this.mokka.change({
        leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || this.mokka.leader,
        state: states.FOLLOWER,
        term: packet.term
      });

    }

    this.mokka.heartbeat(states.LEADER === this.mokka.state ? this.mokka.beat : this.mokka.timeout());

    if (packet.type === messageTypes.VOTE)  //add rule - don't vote for node, until this node receive the right history (full history)
      reply = await this.mokka.actions.vote.vote(packet);


    if (packet.type === messageTypes.VOTED)
      reply = await this.mokka.actions.vote.voted(packet);


    if (packet.type === messageTypes.ERROR)
      this.mokka.emit(messageTypes.ERROR, new Error(packet.data));


    if (packet.type === messageTypes.APPEND)
      reply = await this.mokka.actions.append.append(packet);


    if (packet.type === messageTypes.APPEND_ACK) {
      this.mokka.logger.info(`received append_ack`);
      reply = await this.mokka.actions.append.appendAck(packet);
    }

    if (packet.type === messageTypes.APPEND_FAIL)
      reply = await this.mokka.actions.append.appendFail(packet);


    if (!Object.values(messageTypes).includes(packet.type)) {
      let response = await this.mokka.actions.message.packet('error', 'Unknown message type: ' + packet.type);
      reply = {
        reply: response,
        who: packet.publicKey
      };
    }

    this.mokka.heartbeat(states.LEADER === this.mokka.state ? this.mokka.beat : this.mokka.timeout());






/*    let {index} = await this.mokka.log.getLastInfo();

    let entry = await this.mokka.log.getLastEntry();

    let validateLogSent = this.mokka.cache.get(`requests.${packet.publicKey}.${packet.last.index + 1}`);


    if (!validateLogSent && this.mokka.state === states.LEADER && packet.type === messageTypes.ACK && packet.last && packet.last.index < index && entry.createdAt < Date.now() - this.mokka.beat) {
      reply = await this.mokka.actions.append.obtain(packet);
      this.mokka.logger.trace(`obtained a new log with index ${reply.reply.data.index} for follower`);
      console.log(`requests.${packet.publicKey}.${packet.last.index + 1}`)
      this.mokka.cache.set(`requests.${packet.publicKey}.${packet.last.index + 1}`, true, this.mokka.election.max);
    }*/

    if (!reply && this.mokka.state === states.LEADER)
      return;


/*    if (!reply && packet.type === messageTypes.ACK && index < packet.last.index && packet.last.createdAt < Date.now() - this.mokka.election.max) {//todo add ack case for missed logs

      this.mokka.logger.info(`going to ask for missed logs: ${index} vs ${packet.last.index}`);
      console.log(packet.last)
      let response = await this.mokka.actions.message.packet(messageTypes.ACK);
      response.requestLogs = 1;
      reply = {
        reply: response,
        who: packet.publicKey
      };
    }*/


 /*   if (!reply && packet.type !== messageTypes.ACK) {//todo add ack case for missed logs

      this.mokka.logger.info(`prepare ack packet under state ${this.mokka.state} and packet ${packet.type}`);
      let response = await this.mokka.actions.message.packet(messageTypes.ACK);
      reply = {
        reply: response,
        who: packet.publicKey
      };
    }*/


    return reply;

  }

}


module.exports = RequestProcessor;
