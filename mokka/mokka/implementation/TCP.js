const Mokka = require('../node'),
  msg = require('axon');

class TCPMokka extends Mokka {


  initialize (options) {
    console.log('initializing reply socket on port %s', this.address);

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

   // console.log('writing packet to socket on port %s', this.address);
    this.socket.send(packet, (data) => {
      fn(undefined, data);
    });
  }

}

module.exports = TCPMokka;
