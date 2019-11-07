import crypto from 'crypto';
import {createHmac} from 'crypto';
import voteTypes from '../../shared/constants/EventTypes';
import EventTypes from '../../shared/constants/EventTypes';
import {EntryModel} from '../../storage/models/EntryModel';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {MessageApi} from './MessageApi';
import {NodeApi} from './NodeApi';

class LogApi {

  private mokka: Mokka;
  private run: boolean;
  private nodeApi: NodeApi;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.run = true;
    this.nodeApi = new NodeApi(mokka);
    this.messageApi = new MessageApi(mokka);

  }

  public push(key: string, value: any): void {
    const hash = createHmac('sha256', JSON.stringify({key, value})).digest('hex');
    this.mokka.logger.info(`pushed unconfirmed ${hash} : ${JSON.stringify(value)}`);

    const sign = crypto.createSign('sha256');
    sign.update(hash);

    const signature = sign.sign(this.mokka.rawPrivateKey).toString('hex');
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

      const leaderInfo = this.mokka.getLastLogState();

      for (const node of this.mokka.nodes.values()) {
        const info = node.getLastLogState();

        if (
          leaderInfo.index === info.index ||
          (info.index !== 0 && info.createdAt > Date.now() - this.mokka.election.max) ||
          leaderInfo.createdAt > Date.now() - this.mokka.election.max
        )
          continue;

        await this.broadcastInRange(node, leaderInfo.index);
      }

      if (this.mokka.committedIndex() !== leaderInfo.index) { // todo this may slow down system
        await new Promise((res) => setTimeout(res, this.mokka.heartbeat));

        const status = await new Promise((res) => {
          const timeoutId = setTimeout(() => {
            this.mokka.removeListener(EventTypes.COMMITTED, callback);
            res(0);
          }, this.mokka.heartbeat);

          const callback = () => {
            clearTimeout(timeoutId);
            res(1);
          };
          this.mokka.once(EventTypes.COMMITTED, callback);
        });

        if (status === 0)
          continue;
      }

      const pendings = this.mokka.gossip.getPendings(1); // todo replace with generators + async

      if (!pendings.length) {
        await new Promise((res) => setTimeout(res, this.mokka.heartbeatCtrl.timeout()));
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

      if (entry === null) {
        continue;
      }

      const appendPacket = this.messageApi.packet(messageTypes.APPEND, node.publicKey, entry);
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

    const checkPending = this.mokka.gossip.getPending(hash);

    if (!checkPending) {
      return;
    }

    const entry = await this._save(log);
    this.mokka.gossip.pullPending(hash);
    await this._broadcast(entry.index);

    this.mokka.logger.info(`command has been broadcasted ${JSON.stringify(log)}`);

  }

  private async _save(log: { key: string, value: any }): Promise<EntryModel> {

    const sign = crypto.createSign('sha256');
    sign.update(JSON.stringify(log));

    const signature = sign.sign(this.mokka.rawPrivateKey).toString('hex');

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

  private async _broadcast(index: number): Promise<void> {

    const entry = await this.mokka.getDb().getEntry().get(index);

    this.mokka.logger.info(`broadcasting command ${JSON.stringify(entry.log)} at index ${index}`);

    if (entry.term !== this.mokka.term || this.mokka.state !== states.LEADER)
      return;

    for (const follower of this.mokka.nodes.values()) {
      const appendPacket = this.messageApi.packet(messageTypes.APPEND, follower.publicKey, entry);
      await this.messageApi.message(appendPacket);
    }
  }

}

export {LogApi};
