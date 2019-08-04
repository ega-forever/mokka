import random from 'lodash/random';
import eventTypes from '../../shared/constants/EventTypes';
import {MessageApi} from '../api/MessageApi';
import {NodeApi} from '../api/NodeApi';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';
import {VoteModel} from '../models/VoteModel';

class TimerController {

  private mokka: Mokka;
  private timers: Map<string, NodeJS.Timer>;
  private messageApi: MessageApi;
  private nodeApi: NodeApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.timers = new Map<string, NodeJS.Timer>();
    this.messageApi = new MessageApi(mokka);
    this.nodeApi = new NodeApi(mokka);
  }

  public election(duration: number = random(this.mokka.election.min, this.mokka.election.max)) {
    if (this.timers.has('election'))
      return;

    const electionFunc = () => {
      this.timers.delete('election');
      if (states.LEADER !== this.mokka.state) {
        this.election(duration + this.mokka.election.max); // todo validate
        return this.nodeApi.promote();
      }
    };

    const electionTimeout = setTimeout(electionFunc, duration);

    this.timers.set('election', electionTimeout);

  }

  public heartbeat(duration: number = this.mokka.heartbeat): void {

    if (this.timers.has('heartbeat')) {
      clearTimeout(this.timers.get('heartbeat'));
    }

    const heartbeatFunc = async () => {

      if (states.LEADER !== this.mokka.state) {
        this.mokka.emit(eventTypes.HEARTBEAT_TIMEOUT);
        return this.election();
      }

      const packet = await this.messageApi.packet(messageTypes.ACK);

      await this.messageApi.message(states.FOLLOWER, packet);
      this.heartbeat(this.mokka.heartbeat);
      this.timers.delete('heartbeat');
    };

    const heartbeatTimeout = setTimeout(heartbeatFunc, duration);

    this.timers.set('heartbeat', heartbeatTimeout);
  }

  public setVoteTimeout(): void {

    this.clearVoteTimeout();

    const termChangeFunc = () => {
      this.mokka.vote = new VoteModel();

      if (this.mokka.state === states.CANDIDATE)
        this.mokka.setState(states.FOLLOWER, this.mokka.term - 1, '');

      this.timers.delete('term_change');
    };

    const termChangeTimeout = setTimeout(termChangeFunc, this.mokka.election.max);

    this.timers.set('term_change', termChangeTimeout);
  }

  public clearVoteTimeout(): void {
    if (!this.timers.has('term_change'))
      return;

    clearTimeout(this.timers.get('term_change'));
    this.timers.delete('term_change');
  }

  public clearHeartbeatTimeout(): void {
    if (!this.timers.has('heartbeat'))
      return;

    clearTimeout(this.timers.get('heartbeat'));
    this.timers.delete('heartbeat');
  }

  public clearElectionTimeout(): void {
    if (!this.timers.has('election'))
      return;

    clearTimeout(this.timers.get('election'));
    this.timers.delete('election');
  }

  public timeout() {
    // return _.random(this.beat, parseInt(this.beat * 1.5)); //todo use latency
    return random(this.mokka.heartbeat, Math.round(this.mokka.heartbeat * 1.5)) + 200;
  }

}

export {TimerController};
