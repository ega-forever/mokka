const Mokka = require('../node'),
  msg = require('axon');


class TCPMokka extends Mokka {


  initialize () {
    this.logger.info('initializing reply socket on port %s', this.address);

    this.socket = msg.socket('rep');

    this.socket.bind(this.address);
    this.socket.on('message', (data) => {
      this.emit('data', data);
    });

    this.socket.on('error', () => {
      this.logger.error('failed to initialize on port: ', this.address);
    });
  }

  /**
   * The message to write.
   *
   * @param {Object} packet The packet to write to the connection.
   * @api private
   */
  write (packet) {
    if (!this.socket) {
      this.socket = msg.socket('req');

      this.socket.connect(this.address);
      this.socket.on('error', function err () {
        this.logger.error('failed to write to: ', this.address);
      });
    }

    this.socket.send(packet);
  }

}

module.exports = TCPMokka;
