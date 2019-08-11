import eventTypes from '../../shared/constants/EventTypes';
import {MessageApi} from '../api/MessageApi';
import {NodeApi} from '../api/NodeApi';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';

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

  /*  public election(
      duration: number = Math.round(
        this.mokka.election.min + (this.mokka.election.max - this.mokka.election.min) * Math.random()
      )
    ) {
      if (this.timers.has('election'))
        return;

      const electionFunc = async () => {
        if (states.LEADER === this.mokka.state || this.mokka.leaderPublicKey) {
          return;
        }

        await this.nodeApi.promote();
        this.timers.delete('election');
        this.election(duration + this.mokka.election.max); // todo validate

      };

      const electionTimeout = setTimeout(electionFunc, duration);

      this.timers.set('election', electionTimeout);

    }*/

  public heartbeat(duration: number = this.mokka.heartbeat): void {

    if (this.timers.has('heartbeat')) {
      clearTimeout(this.timers.get('heartbeat'));
    }

    const heartbeatFunc = async () => {

      if (states.LEADER !== this.mokka.state) {
        this.mokka.emit(eventTypes.HEARTBEAT_TIMEOUT);
        this.mokka.setState(states.FOLLOWER, this.mokka.term, null, null);
        return await this.nodeApi.promote();
      }

      for (const node of this.mokka.nodes.values()) {
        const packet = await this.messageApi.packet(messageTypes.ACK, node.publicKey);
        await this.messageApi.message(packet);
      }

      this.timers.delete('heartbeat');
      this.heartbeat(this.mokka.heartbeat);
    };

    const heartbeatTimeout = setTimeout(heartbeatFunc, duration);

    this.timers.set('heartbeat', heartbeatTimeout);
  }

  /*
    public setVoteTimeout(): void {

      this.clearVoteTimeout();

      const termChangeFunc = () => {
        this.mokka.vote = new VoteModel();

        if (this.mokka.state === states.CANDIDATE) {
        this.mokka.logger.info('rollback!!');
          this.mokka.setState(states.FOLLOWER, this.mokka.term - 1, '');
        }

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
  */

  public clearHeartbeatTimeout(): void {
    if (!this.timers.has('heartbeat'))
      return;

    clearTimeout(this.timers.get('heartbeat'));
    this.timers.delete('heartbeat');
  }

/*  public clearElectionTimeout(): void {
    if (!this.timers.has('election'))
      return;

    clearTimeout(this.timers.get('election'));
    this.timers.delete('election');
  }*/

  public timeout() {
    // return _.random(this.beat, parseInt(this.beat * 1.5)); //todo use latency

    return this.mokka.heartbeat * 1.2 + Math.round((this.mokka.heartbeat * 0.5) * Math.random());
  }

}

export {TimerController};
