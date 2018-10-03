const _ = require('lodash'),
  states = require('../factories/stateFactory');


const _timing  = function (latency) {
  let raft = this,
    sum = 0,
    i = 0;

  if (states.STOPPED === raft.state)
    return false;

  for (; i < latency.length; i++) {
    sum += latency[i];
  }

  raft.latency = Math.floor(sum / latency.length);

  if (raft.latency > raft.election.min * raft.threshold) {
    raft.emit('threshold');
  }

  return true;
};


const message = function (who, what, when) {

  if (typeof who === 'undefined') {
    throw new Error('Cannot send message to `undefined`. Check your spelling!');
  }

  let output = {errors: {}, results: {}},
    length = this.nodes.length,
    errors = false,
    latency = [],
    raft = this,
    nodes = [],
    i = 0;

  switch (who) {
    case states.LEADER:
      for (; i < length; i++)
        if (raft.leader === raft.nodes[i].publicKey) {
          nodes.push(raft.nodes[i]);
        }
      break;

    case states.FOLLOWER:
      for (; i < length; i++)
        if (raft.leader !== raft.nodes[i].publicKey) {
          nodes.push(raft.nodes[i]);
        }
      break;

    case states.CHILD:
      Array.prototype.push.apply(nodes, raft.nodes);
      break;

    default:
      for (; i < length; i++)
        if (who === raft.nodes[i].publicKey) {
          nodes.push(raft.nodes[i]);
        }
  }

  /**
   * A small wrapper to force indefinitely sending of a certain packet.
   *
   * @param {Raft} client Raft we need to write a message to.
   * @param {Object} data Message that needs to be send.
   * @api private
   */
  function wrapper (client, data) {
    let start = +new Date();

    client.write(data, function written (err, data) {
      latency.push(+new Date() - start);

      //
      // Add the error or output to our `output` object to be
      // passed to the callback when all the writing is done.
      //
      if (err) {
        errors = true;
        output.errors[client.publicKey] = err;
      } else {
        output.results[client.publicKey] = data;
      }

      if (err) raft.emit('error', err);
      else if (data) raft.emit('data', data);

      if (latency.length === length) {
        _timing.apply(raft, latency);
        if (when)
          when(errors ? output.errors : undefined, output.results);
        latency.length = nodes.length = 0;
        output = null;
      }
    });
  }

  length = nodes.length;
  i = 0;

  for (; i < length; i++) {
    wrapper(nodes[i], what);
  }

  return raft;
};

const packet = async function (type, data) {
  let raft = this,
    wrapped = {
      state: raft.state,
      term: raft.term,
      address: raft.address, //todo remove
      publicKey: raft.publicKey,
      type: type,
      leader: raft.leader
    };


  if (raft.log)
    wrapped.last = await raft.log.getLastInfo();

  if (arguments.length === 2)
    wrapped.data = data;

  return wrapped;
};

const appendPacket = async function (entry) {
  const raft = this;
  const last = await raft.log.getEntryInfoBefore(entry);
  return {
    state: raft.state,
    term: raft.term,
    address: raft.address, //todo remove
    publicKey: raft.publicKey,
    type: 'append',
    leader: raft.leader,
    data: [entry],
    last
  };
};

module.exports = (instance) => {

  _.set(instance, 'actions.message', {
    message: message.bind(instance),
    packet: packet.bind(instance),
    appendPacket: appendPacket.bind(instance)
  });

};
