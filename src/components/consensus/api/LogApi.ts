import * as Bpromise from 'bluebird';
import * as crypto from 'crypto';
import * as _ from 'lodash';
import semaphore = require('semaphore');
import {Semaphore} from 'semaphore';
import * as nacl from 'tweetnacl';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {MessageApi} from './MessageApi';
import {NodeApi} from './NodeApi';

class LogApi {

  private mokka: Mokka;
  private semaphore: Semaphore;
  private run: boolean;
  private nodeApi: NodeApi;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.semaphore = semaphore(1);
    this.mokka = mokka;
    this.run = true;
    this.nodeApi = new NodeApi(mokka);
    this.messageApi = new MessageApi(mokka);

  }

  public push(key: string, value: any): void {
    const hash = crypto.createHmac('sha256', JSON.stringify({key, value})).digest('hex');
    this.mokka.logger.info(`pushed unconfirmed ${hash} : ${JSON.stringify(value)}`);
    this.mokka.gossip.push(hash, {key, value});
  }

  public async runLoop() { // loop for checking new packets

    if (!this.run)
      this.run = true;

    while (this.run) {

      if (this.mokka.state !== states.LEADER) {
        await Bpromise.delay(100);
        continue;
      }

      const pendings = await this.mokka.gossip.getPendings(1);

      if (!pendings.length) {
        await Bpromise.delay(this.mokka.timer.timeout()); // todo delay for next tick or event on new push
        continue;
      }

      await this._commit(pendings[0].log, pendings[0].hash);
    }
  }

  public stop() {
    this.run = false;
  }

  public async _commit(log: any, hash: string): Promise<void> {

    // @ts-ignore
    return await new Promise((res) =>
      this.semaphore.take(async () => {

        const checkPending = this.mokka.gossip.getPending(hash);

        if (!checkPending) {
          this.semaphore.leave();
          return res();
        }

        const entry = await this._save(log);
        this.mokka.gossip.pullPending(hash);
        await this._broadcast(entry.index, entry.hash);

        this.mokka.logger.info(`command has been broadcasted ${JSON.stringify(log)}`);
        await this.mokka.gossip.pullPending(hash);

        this.semaphore.leave();
        res();
      })
    );
  }

  public async _save(log: string) {
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(JSON.stringify(log)),
        Buffer.from(this.mokka.privateKey, 'hex')
      )
    ).toString('hex');

    return await this.mokka.getDb().getLog().save(log, this.mokka.term, signature, [this.mokka.publicKey]);
  }

  public async _broadcast(index: number, hash: string) {

    const entry = await this.mokka.getDb().getEntry().get(index);

    if (!entry || entry.hash !== hash)
      return this.mokka.logger.trace(`can't broadcast entry at index ${index}`);

    this.mokka.logger.info(`broadcasting command ${JSON.stringify(entry.log)} at index ${index}`);

    if (entry.term !== this.mokka.term || this.mokka.state !== states.LEADER)
      return entry;

    const followers = _.chain(this.mokka.nodes)
      .reject((node) => _.find(entry.responses, {publicKey: node.publicKey}))
      .value();

    if (followers.length === 0)
      return entry;

    const appendPacket = await this.messageApi.packet(messageTypes.APPEND, entry);
    const pubKeys = followers.map((node: NodeModel) => node.publicKey);

    await this.messageApi.message(pubKeys, appendPacket);
  }

}

export {LogApi};
