import * as zmq from 'zeromq';

import {Mokka} from '../consensus/main';

class ZMQMokka extends Mokka {

  private sockets: Map<string, zmq.Pair> = new Map<string, any>();

  public async initialize() {
    this.logger.info(`initializing reply socket on port  ${this.address}`);

    const socket = new zmq.Pair({receiveHighWaterMark: 10});
    await socket.bind(this.address);

    this.sockets.set(this.address, socket);

    for await (const [msg] of this.sockets.get(this.address)) {
      await this.emitPacket(msg);
    }

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
      const socket = new zmq.Pair({receiveHighWaterMark: 10});
      socket.connect(address);
      this.sockets.set(address, socket);
    }

    try {
      await this.sockets.get(address).send(packet);
    } catch (e) {
      this.sockets.get(address).close();
      const socket = new zmq.Pair({receiveHighWaterMark: 10});
      socket.connect(address);
      this.sockets.set(address, socket);
    }
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

export default ZMQMokka;
