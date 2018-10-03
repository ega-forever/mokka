const _ = require('lodash'),
  Multiaddr = require('multiaddr'),
  hashUtils = require('../utils/hashes'),
  states = require('../factories/stateFactory');

const join = function (multiaddr, write) {
  let raft = this;


  const m = Multiaddr(multiaddr);

  const publicKey = hashUtils.getHexFromIpfsHash(m.getPeerId());
  if (raft.publicKey === publicKey)
    return;

  const mOptions = m.toOptions();

  let node = raft.clone({
    write: write,
    publicKey:  publicKey,
    address: `${mOptions.transport}://${mOptions.host}:${mOptions.port}`,
    state: states.CHILD
  });

  node.once('end', function end () {
    raft.leave(node);
  }, raft);

  raft.nodes.push(node);
  raft.emit('join', node);

  return node;
};

const leave = function (publicKey) {
  let raft = this,
    index = -1,
    node;

  for (let i = 0; i < raft.nodes.length; i++) {
    if (raft.nodes[i] === publicKey || raft.nodes[i].publicKey === publicKey) {
      node = raft.nodes[i];
      index = i;
      break;
    }
  }

  if (~index && node) {
    raft.nodes.splice(index, 1);

    if (node.end) node.end();
    raft.emit('leave', node);
  }

  return node;
};

const end = function () {
  let raft = this;

  if (states.STOPPED === raft.state) return false;
  raft.change({state: states.STOPPED});

  if (raft.nodes.length)
    for (let i = 0; i < raft.nodes.length; i++)
      raft.leave(raft.nodes[i]);


  raft.emit('end');
  raft.timers.end();
  raft.removeAllListeners();

  if (raft.log)
    raft.log.end();

  raft.timers = raft.Log = raft.beat = raft.election = null;
  return true;
};

const promote = async function () {
  let raft = this;

  raft.change({
    state: states.CANDIDATE,  // We're now a candidate,
    term: raft.term + 1,    // but only for this term.
    leader: ''              // We no longer have a leader.
  });

  raft.votes.for = raft.publicKey;
  raft.votes.granted = 1;

  const packet = await raft.actions.message.packet('vote');

  raft.actions.message.message(states.FOLLOWER, packet);

  raft.timers
    .clear('heartbeat, election')
    .setTimeout('election', raft.actions.node.promote, raft.timeout());

  return raft;
};


module.exports = (instance) => {

  _.set(instance, 'actions.node', {
    promote: promote.bind(instance),
    join: join.bind(instance),
    leave: leave.bind(instance),
    end: end.bind(instance)
  });

};