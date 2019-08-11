import {createHmac} from 'crypto';
import semaphore, {Semaphore} from 'semaphore';
import nacl = require('tweetnacl');
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

      const aliveNodes = Array.from(this.mokka.nodes.values()).filter((node) => node.getLastLogState().index !== -1);

      const leaderInfo = await this.mokka.getDb().getState().getInfo(this.mokka.publicKey);

      for (const node of aliveNodes) {
        const info = await this.mokka.getDb().getState().getInfo(node.publicKey);

        // todo use latency
        if (leaderInfo.index === info.index || info.createdAt < Date.now() - this.mokka.election.max)
          continue;

        await this.broadcastInRange(node, leaderInfo.index);
      }

      if (this.mokka.committedIndex() !== leaderInfo.index) { // todo this may slow down system
        await new Promise((res) => setTimeout(res, this.mokka.heartbeat));
        continue;
      }

      const pendings = this.mokka.gossip.getPendings(1); // todo replace with generators + async

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

  private async broadcastInRange(node: NodeModel, lastIndex: number) {
    for (let index = (node.getLastLogState().index || 1); index <= lastIndex; index++) {
      const entry = await this.mokka.getDb().getEntry().get(index);
      const appendPacket = await this.messageApi.packet(messageTypes.APPEND, node.publicKey, entry);
      await this.messageApi.message(appendPacket);

      const status = await new Promise((res) => {
        const evName = `${node.publicKey}:${messageTypes.APPEND_ACK}`;

        const timeoutId = setTimeout(() => {
          this.mokka.removeListener(evName, ev);
          res(0);
        }, 500); // todo validate, that the event is triggered in timeout

        const ev = () => {
          clearTimeout(timeoutId);
          res(1);
        };

        this.mokka.once(evName, ev);
      });

      if (!status) {
        node.setLastLogState({index: -1, hash: null, term: 0, createdAt: Date.now()}); // todo set peer as dead
        return;
      }
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

    const entry = await this.mokka.getDb().getLog().save(
      this.mokka.publicKey,
      log,
      this.mokka.term,
      signature);

    this.mokka.setLastLogState({
      createdAt: entry.createdAt,
      hash: entry.hash,
      index: entry.index,
      term: entry.term
    });

    this.mokka.emit(voteTypes.LOG, entry.index);
    this.mokka.emit(voteTypes.LOG_ACK, entry.index);
    return entry;
  }

  private async _broadcast(index: number, hash: string): Promise<void> {

    const entry = await this.mokka.getDb().getEntry().get(index);

    if (!entry || entry.hash !== hash) {
      this.mokka.logger.trace(`can't broadcast entry at index ${index}`);
      return;
    }

    this.mokka.logger.info(`broadcasting command ${JSON.stringify(entry.log)} at index ${index}`);

    if (entry.term !== this.mokka.term || this.mokka.state !== states.LEADER)
      return;

    const followers = Array.from(this.mokka.nodes.values()).filter((node) => node.getLastLogState().index !== -1);

    if (followers.length === 0)
      return;

    for (const follower of followers) {
      const appendPacket = await this.messageApi.packet(messageTypes.APPEND, follower.publicKey, entry);
      await this.messageApi.message(appendPacket);
    }
  }

}

export {LogApi};
