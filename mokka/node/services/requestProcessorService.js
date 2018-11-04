const _ = require('lodash'),
  states = require('../factories/stateFactory'),
  messageTypes = require('../factories/messageTypesFactory'),
  validateSecretUtil = require('../../utils/validateSecret'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.services.requestProcessor'});


class RequestProcessor {

  constructor (mokka) {
    this.mokka = mokka;
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

    if (states.LEADER === packet.state && packet.type === messageTypes.APPEND) {


      if (!_.has(packet, 'proof.index') && !_.has(packet, 'proof.shares')) {
        log.info('proof is not provided!');
        let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
        return {
          reply: reply,
          who: packet.publicKey
        };
      }


      let pubKeys = this.mokka.nodes.map(node => node.publicKey);
      pubKeys.push(this.mokka.publicKey);

      if (packet.proof.index && _.has(packet, 'proof.shares')) {

        let proofEntry = await this.mokka.log.get(packet.proof.index);

        let validated = validateSecretUtil(
          this.mokka.networkSecret,
          this.mokka.election.max,
          pubKeys,
          packet.proof.secret,
          _.get(proofEntry, 'createdAt', Date.now()),
          packet.proof.shares);

        if (!validated) {
          log.error('the initial proof validation failed');
          let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
          return {
            reply: reply,
            who: packet.publicKey
          };
        }

        await this.mokka.log.addProof(packet.term, packet.proof)
      }


      if (packet.proof.index && !_.has(packet, 'proof.shares')) {

        let proofEntryShare = await this.mokka.log.getProof(packet.term);

        if (!proofEntryShare) {
          log.error('the secondary proof validation failed');
          let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
          return {
            reply: reply,
            who: packet.publicKey
          };
        }
      }

      this.mokka.change({
        leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || this.mokka.leader,
        state: states.FOLLOWER,
        term: packet.term
      });

    }

    this.mokka.heartbeat(states.LEADER === this.mokka.state ? this.mokka.beat : this.mokka.timeout());


    if (packet.type === messageTypes.VOTE) { //add rule - don't vote for node, until this node receive the right history (full history)
      reply = await this.mokka.actions.vote.vote(packet);
    }

    if (packet.type === messageTypes.VOTED) {
      reply = await this.mokka.actions.vote.voted(packet);
    }

    if (packet.type === messageTypes.ERROR) {
      this.mokka.emit(messageTypes.ERROR, new Error(packet.data));
    }


    if (packet.type === messageTypes.APPEND) {
      reply = await this.mokka.actions.append.append(packet);
    }

    if (packet.type === messageTypes.APPEND_ACK) {
      reply = await this.mokka.actions.append.appendAck(packet);
    }

    if (packet.type === messageTypes.APPEND_FAIL) {
      reply = await this.mokka.actions.append.appendFail(packet);
    }

    if (!Object.values(messageTypes).includes(packet.type)) {
      let response = await this.mokka.actions.message.packet('error', 'Unknown message type: ' + packet.type);
      reply = {
        reply: response,
        who: packet.publicKey
      }
    }

    if (!reply) {
      let response = await this.mokka.actions.message.packet(messageTypes.ACK);
      reply = {
        reply: response,
        who: packet.publicKey
      };
    }


    return reply;

  }

}


module.exports = RequestProcessor;