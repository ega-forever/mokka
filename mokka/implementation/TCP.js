const Mokka = require('../node'),
  msg = require('axon'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'implementation.TCP'});


class TCPMokka extends Mokka {


  initialize () {
    log.info('initializing reply socket on port %s', this.address);

    this.socket = msg.socket('rep');

    this.socket.bind(this.address);
    this.socket.on('message', (data, fn) => {
      this.emit('data', data, fn);
    });

    this.socket.on('error', () => {
      log.error('failed to initialize on port: ', this.address);
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
        log.error('failed to write to: ', this.address);
      });
    }

    this.socket.send(packet);
  }

}

module.exports = TCPMokka;
