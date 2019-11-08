import msg from 'axon';

import {Mokka} from '../components/consensus/main';

class TCPMokka extends Mokka {

  private sockets: Map<string, any> = new Map<string, any>();

  public initialize() {
    this.logger.info(`initializing reply socket on port  ${this.address}`);

    this.sockets.set(this.address, msg.socket('sub-emitter'));

    this.sockets.get(this.address).bind(this.address);
    this.sockets.get(this.address).on('message', (data: Buffer) => {
      this.emitPacket(data);
    });

    this.sockets.get(this.address).on('error', () => {
      this.logger.error(`failed to initialize on port: ${this.address}`);
    });
  }

  /**
   * The message to write.
   *
   * @param {string} address The peer address
   * @param {Object} packet The packet to write to the connection.
   * @api private
   */
  public async write(address: string, packet: Buffer): Promise<void> {

    if (!this.sockets.has(address)) {
      this.sockets.set(address, msg.socket('pub-emitter'));

      this.sockets.get(address).connect(address);
    }

    this.sockets.get(address).emit('message', packet);
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
    for (const socket of this.sockets.values()) {
      socket.close();
    }
  }

  public async connect(): Promise<void> {
    this.initialize();
    await super.connect();
  }

}

export default TCPMokka;
