import random from 'lodash/random';
// @ts-ignore
import Tick from 'tick-tock';
import eventTypes from '../../shared/constants/EventTypes';
import {MessageApi} from '../api/MessageApi';
import {NodeApi} from '../api/NodeApi';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {VoteModel} from '../models/VoteModel';

class TimerController {

  private mokka: Mokka;
  private timers: any;
  private messageApi: MessageApi;
  private nodeApi: NodeApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.timers = new Tick(this);
    this.messageApi = new MessageApi(mokka);
    this.nodeApi = new NodeApi(mokka);
  }

  public election(duration: number = random(this.mokka.election.min, this.mokka.election.max)) {
    if (this.timers.active('election'))
      return;

    this.timers.setTimeout('election', async () => {
      if (states.LEADER !== this.mokka.state) {
        this.election(duration + this.mokka.election.max); // todo validate
        return this.nodeApi.promote();
      }
    }, duration);

  }

  public heartbeat(duration: number = this.mokka.heartbeat): void {

    if (this.timers.active('heartbeat') && this.mokka.state !== states.LEADER) {
      this.timers.adjust('heartbeat', duration);
      return;
    }

    if (this.timers.active('heartbeat'))
      this.timers.clear('heartbeat');

    this.timers.setTimeout('heartbeat', async () => {

      if (states.LEADER !== this.mokka.state) {
        this.mokka.emit(eventTypes.HEARTBEAT_TIMEOUT);
        return this.election();
      }

      const packet = await this.messageApi.packet(messageTypes.ACK);

      await this.messageApi.message(states.FOLLOWER, packet);
      this.heartbeat(this.mokka.heartbeat);
    }, duration);

  }

  public setVoteTimeout(): void {

    this.clearVoteTimeout();

    this.timers.setTimeout('term_change', async () => {
      this.mokka.vote = new VoteModel();

      if (this.mokka.state === states.CANDIDATE)
        this.mokka.setState(states.FOLLOWER, this.mokka.term - 1, '');

    }, this.mokka.election.max);

  }

  public clearVoteTimeout(): void {
    if (this.timers.active('term_change'))
      this.timers.clear('term_change');
  }

  public clearHeartbeatTimeout(): void {
    if (this.timers.active('heartbeat'))
      this.timers.clear('heartbeat');
  }

  public clearElectionTimeout(): void {
    if (this.timers.active('election'))
      this.timers.clear('election');
  }

  public timeout() {
    // return _.random(this.beat, parseInt(this.beat * 1.5)); //todo use latency
    return random(this.mokka.heartbeat, Math.round(this.mokka.heartbeat * 1.5)) + 200;
  }

}

export {TimerController};
