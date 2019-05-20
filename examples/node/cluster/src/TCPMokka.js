const Mokka = require('mokka');
const msg = require('axon');

class TCPMokka extends Mokka.Mokka {

  constructor (settings){
    super(settings);
    this.sockets = {};
  }

  /**
   * the init function (fires during mokka's init process
   */
  initialize () {
    this.logger.info(`initializing reply socket on port  ${this.address}`);

    this.sockets[this.address] = msg.socket('rep');

    this.sockets[this.address].bind(this.address);

    // here we bind sockets between peers and start listening to new packets
    this.sockets[this.address].on('message', (data) => {
      this.emit('data', data);
    });

    this.sockets[this.address].on('error', () => {
      this.logger.error(`failed to initialize on port: ${this.address}`);
    });
  }

  /**
   * The message to write.
   *
   * @param address the address, to which write msg
   * @param packet the packet to write
   */
  async write (address, packet) {

    if (!this.sockets[address]) {
      this.sockets[address] = msg.socket('req');

      this.sockets[address].connect(address);
      this.sockets[address].on('error', () => {
        this.logger.error(`failed to write to: ${this.address}`);
      });
    }

    this.sockets[address].send(packet);
  }

  async disconnect () {
    await super.disconnect();
    for (const socket of Object.values(this.sockets)) {
      socket.close();
    }
  }

  connect () {
    this.initialize();
    super.connect();
  }

}

module.exports = TCPMokka;
