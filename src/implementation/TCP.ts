// @ts-ignore
import msg from 'axon';

import {Mokka} from '../components/consensus/main';

class TCPMokka extends Mokka {

  private sockets: Map<string, any> = new Map<string, any>();

  public initialize() {
    this.logger.info(`initializing reply socket on port  ${this.address}`);

    this.sockets.set(this.address, msg.socket('rep'));

    this.sockets.get(this.address).bind(this.address);
    this.sockets.get(this.address).on('message', (data: Buffer) => {
      this.emit('data', data);
    });

    this.sockets.get(this.address).on('error', () => {
      this.logger.error(`failed to initialize on port: ${this.address}`);
    });
  }

  /**
   * The message to write.
   *
   * @param {Object} packet The packet to write to the connection.
   * @api private
   */
  public async write(address: string, packet: Buffer): Promise<void> {

    if (!this.sockets.has(address)) {
      this.sockets.set(address, msg.socket('req'));

      this.sockets.get(address).connect(address);
      this.sockets.get(address).on('error', () => {
        this.logger.error(`failed to write to: ${this.address}`);
      });
    }

    this.sockets.get(address).send(packet);
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
