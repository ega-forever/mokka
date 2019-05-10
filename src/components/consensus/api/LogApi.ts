import {createHmac} from 'crypto';
import {Semaphore} from 'semaphore';
import semaphore from 'semaphore';
import nacl from 'tweetnacl';
import voteTypes from '../../shared/constants/EventTypes';
import {EntryModel} from '../../storage/models/EntryModel';
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
    const hash = createHmac('sha256', JSON.stringify({key, value})).digest('hex');
    this.mokka.logger.info(`pushed unconfirmed ${hash} : ${JSON.stringify(value)}`);
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(hash),
        Buffer.from(this.mokka.privateKey, 'hex')
      )
    ).toString('hex');
    this.mokka.gossip.push(hash, {key, value, signature});
  }

  public stop() {
    this.run = false;
  }

  public async runLoop() { // loop for checking new packets

    if (!this.run)
      this.run = true;

    while (this.run) {

      if (this.mokka.state !== states.LEADER) {
        await new Promise((res) => setTimeout(res, 100));
        continue;
      }

      const pendings = this.mokka.gossip.getPendings(1);

      if (!pendings.length) {
        await new Promise((res) => setTimeout(res, this.mokka.timer.timeout()));
        continue;
      }

      const pending = pendings[0];

      if (!pending.log.signature) {
        return this.mokka.gossip.pullPending(pending.hash);
      }

      await this._commit({key: pending.log.key, value: pending.log.value}, pending.hash);
    }
  }

  private async _commit(log: { key: string, value: any }, hash: string): Promise<void> {

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
        this.semaphore.leave();
        res();
      })
    );
  }

  private async _save(log: { key: string, value: any }): Promise<EntryModel> {
    const signature = Buffer.from(
      nacl.sign.detached(
        Buffer.from(JSON.stringify(log)),
        Buffer.from(this.mokka.privateKey, 'hex')
      )
    ).toString('hex');

    const entry = await this.mokka.getDb().getLog().save(log, this.mokka.term, signature, [this.mokka.publicKey]);
    this.mokka.emit(voteTypes.LOG, entry.index);
    this.mokka.emit(voteTypes.LOG_ACK, entry.index);
    return entry;
  }

  private async _broadcast(index: number, hash: string) {

    const entry = await this.mokka.getDb().getEntry().get(index);

    if (!entry || entry.hash !== hash)
      return this.mokka.logger.trace(`can't broadcast entry at index ${index}`);

    this.mokka.logger.info(`broadcasting command ${JSON.stringify(entry.log)} at index ${index}`);

    if (entry.term !== this.mokka.term || this.mokka.state !== states.LEADER)
      return entry;

    const followers = this.mokka.nodes.filter((node) =>
      !entry.responses.includes(node.publicKey)
    );

    if (followers.length === 0)
      return entry;

    const appendPacket = await this.messageApi.packet(messageTypes.APPEND, entry);
    const pubKeys = followers.map((node: NodeModel) => node.publicKey);

    await this.messageApi.message(pubKeys, appendPacket);
  }

}

export {LogApi};
