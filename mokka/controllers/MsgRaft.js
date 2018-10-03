const debug = require('diagnostics')('raft'),
  LifeRaft = require('../raft'),
  secrets = require('secrets.js-grempe'),
  _ = require('lodash'),
  Web3 = require('web3'),
  web3 = new Web3(),
  EthUtil = require('ethereumjs-util'),
  crypto = require('crypto'),
  msg = require('axon');

class MsgRaft extends LifeRaft {

  /**
   * Initialized, start connecting all the things.
   *
   * @param {Object} options Options.
   * @api private
   */
  initialize (options) {
    debug('initializing reply socket on port %s', this.address);

    const socket = this.socket = msg.socket('rep');

    socket.bind(this.address);
    socket.on('message', (data, fn) => {
      this.emit('data', data, fn);
    });

    socket.on('error', () => {
      debug('failed to initialize on port: ', this.address);
    });
  }

  /**
   * The message to write.
   *
   * @param {Object} packet The packet to write to the connection.
   * @param {Function} fn Completion callback.
   * @api private
   */
  write (packet, fn) {
    if (!this.socket) {
      this.socket = msg.socket('req');

      this.socket.connect(this.address);
      this.socket.on('error', function err () {
        console.error('failed to write to: ', this.address);
      });
    }

    debug('writing packet to socket on port %s', this.address);
    this.socket.send(packet, (data) => {
      fn(undefined, data);
    });
  }

}

module.exports = MsgRaft;
