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

  public heartbeat(duration: number = this.mokka.heartbeat): void {

    if (this.timers.has('heartbeat')) {
      clearTimeout(this.timers.get('heartbeat'));
    }

    const heartbeatFunc = async () => {

      if (this.mokka.state !== states.LEADER || this.mokka.isProofTokenExpired()) {
        this.mokka.emit(eventTypes.HEARTBEAT_TIMEOUT);
        this.mokka.setState(states.FOLLOWER, this.mokka.term, null, null);
        await this.nodeApi.promote();

        if (this.mokka.state !== states.LEADER) {
          return this.heartbeat(this.timeout());
        }
      }

      for (const node of this.mokka.nodes.values()) {
        const packet = this.messageApi.packet(messageTypes.ACK, node.publicKey);
        await this.messageApi.message(packet);
      }

      this.heartbeat(this.mokka.heartbeat);
    };

    const heartbeatTimeout = setTimeout(heartbeatFunc, duration);

    this.timers.set('heartbeat', heartbeatTimeout);
  }

  public clearHeartbeatTimeout(): void {
    if (!this.timers.has('heartbeat'))
      return;

    clearTimeout(this.timers.get('heartbeat'));
    this.timers.delete('heartbeat');
  }

  public timeout() {
    return this.mokka.heartbeat * 1.2 + Math.round((this.mokka.heartbeat * 0.5) * Math.random());
  }

}

export {TimerController};
