// @ts-ignore
import msg from 'axon';

import {Mokka} from '../components/consensus/main';
import {IIndexObject} from '../components/gossip/types/IIndexObjectType';

class TCPMokka extends Mokka {

  private sockets: IIndexObject<any> = {};

  public initialize() {
    this.logger.info(`initializing reply socket on port  ${this.address}`);

    this.sockets[this.address] = msg.socket('rep');

    this.sockets[this.address].bind(this.address);
    this.sockets[this.address].on('message', (data: Buffer) => {
      this.emit('data', data);
    });

    this.sockets[this.address].on('error', () => {
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

    if (!this.sockets[address]) {
      this.sockets[address] = msg.socket('req');

      this.sockets[address].connect(address);
      this.sockets[address].on('error', () => {
        this.logger.error(`failed to write to: ${this.address}`);
      });
    }

    this.sockets[address].send(packet);
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
    for (const socket of Object.values(this.sockets)) {
      socket.close();
    }
  }

  public connect(): void {
    this.initialize();
    super.connect();
  }

}

export default TCPMokka;
