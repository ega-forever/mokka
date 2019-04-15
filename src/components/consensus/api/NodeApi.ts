import * as BPromise from 'bluebird';
import * as _ from 'lodash';
// @ts-ignore
import * as secrets from 'secrets.js-grempe';
import {Semaphore} from 'semaphore';
import semaphore = require('semaphore');
import * as nacl from 'tweetnacl';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {NodeModel} from '../models/NodeModel';
import {VoteModel} from '../models/VoteModel';
import {MessageApi} from './MessageApi';

class NodeApi {

  private mokka: Mokka;
  private semaphore: Semaphore;
  private messageApi: MessageApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.semaphore = semaphore(1);
    this.messageApi = new MessageApi(mokka);
  }

  public join(multiaddr: string): NodeModel {

    const publicKey = multiaddr.match(/\w+$/).toString();

    if (this.mokka.publicKey === publicKey)
      return;

    const node = new NodeModel(null, multiaddr, states.CHILD);

    node.write = this.mokka.write.bind(this.mokka);
    node.once('end', () => this.leave(node.publicKey));

    this.mokka.nodes.push(node);
    this.mokka.emit('join', node);

    this.mokka.gossip.handleNewPeers([publicKey]);

    return node;
  }

  public leave(publicKey: string): void {

    const index = _.findIndex(this.mokka.nodes, (node: NodeModel) => node.publicKey === publicKey);

    if (index === -1)
      return;

    this.mokka.nodes.splice(index, 1);

    const node = this.mokka.nodes[index];
    this.mokka.emit('leave', node);
  }

  public async promote() {

    return await new Promise((res) => {

      this.semaphore.take(async () => {

        const startTime = Date.now();
        const token = startTime.toString();
        const secret = secrets.str2hex(token);

        // @ts-ignore
        const shares = _.chain(secrets.share(secret, this.mokka.nodes.length + 1, this.mokka.majority()))
          .sortBy()
          .map((share: string, index: number) => {

            if (index === this.mokka.nodes.length) {
              const signature = Buffer.from(
                nacl.sign.detached(
                  Buffer.from(share),
                  Buffer.from(this.mokka.privateKey, 'hex')
                )
              ).toString('hex');
              return {
                publicKey: this.mokka.publicKey,
                share,
                signature,
                voted: true
              };
            }

            return {
              publicKey: this.mokka.nodes[index].publicKey,
              share,
              signature: null,
              voted: false
            };
          })
          .value();

        this.mokka.vote = new VoteModel(this.mokka.publicKey, shares, secret, startTime);
        this.mokka.setState(states.CANDIDATE, this.mokka.term + 1, '');

        const startVote = Date.now();
        for (const share of _.initial(shares)) {
          const packet = await this.messageApi.packet(messageTypes.VOTE, {
            // @ts-ignore
            share: share.share
          });

          // @ts-ignore
          await this.messageApi.message(share.publicKey, packet);
        }

        const timeout = this.mokka.timer.timeout() - (Date.now() - startVote);

        if (timeout > 0)
          await BPromise.delay(timeout);

        this.mokka.timer.setVoteTimeout();
        this.semaphore.leave();
        res();
      });

    });
  }

}

export {NodeApi};
