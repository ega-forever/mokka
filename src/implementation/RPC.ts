import axios from 'axios';
import bodyParser from 'body-parser';
import express from 'express';
import {URL} from 'url';
import {Mokka} from '../consensus/main';

class RPCMokka extends Mokka {

  private app = express();

  public initialize() {

    this.app.use(bodyParser.json());

    this.app.post('/', (req, res) => {
      const packet = Buffer.from(req.body.data, 'hex');
      this.emitPacket(packet);
      res.send({ok: 1});
    });

    const url = new URL(this.address);

    this.app.listen(url.port, () => {
      this.logger.info(`rpc started on port ${url.port}`);
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

    await axios.post(address, {
      data: packet.toString('hex')
    }, {
      timeout: this.heartbeat
    }).catch((e) => {
      this.logger.trace(`received error from ${address}: ${e}`);
    });
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
    this.app.close();
  }

  public async connect(): Promise<void> {
    this.initialize();
    await super.connect();
  }

}

export default RPCMokka;
