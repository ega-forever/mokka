const TCPImplementation = require('./implementation/TCP'),
  StorageLog = require('./log/log'),
  Node = require('./node');

module.exports = {
  implementation: {
    TCP: TCPImplementation
  },
  storage: StorageLog,
  Node: Node
};
