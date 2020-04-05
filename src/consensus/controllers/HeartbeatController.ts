import {MessageApi} from '../api/MessageApi';
import {NodeApi} from '../api/NodeApi';
import eventTypes from '../constants/EventTypes';
import EventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';

class HeartbeatController {

  private mokka: Mokka;
  private adjustmentDate: number;
  private messageApi: MessageApi;
  private nodeApi: NodeApi;
  private runBeat: boolean;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.messageApi = new MessageApi(mokka);
    this.nodeApi = new NodeApi(mokka);
    this.runBeat = false;
  }

  public async stopBeat() {
    this.runBeat = false;
    if (this.adjustmentDate)
      await new Promise((res) => setTimeout(res, Date.now() - this.adjustmentDate));
  }

  public async watchBeat() {

    this.runBeat = true;

    while (this.runBeat) {
      if (this.adjustmentDate > Date.now()) {
        await new Promise((res) => setTimeout(res, this.adjustmentDate - Date.now()));
        continue;
      }

      if (this.mokka.state === states.CANDIDATE) {
        await new Promise((res) => this.mokka.once(EventTypes.STATE, res));
        this.setNextBeat(this.timeout() * (3 +  Math.round(2 * Math.random()) )); // should be 3-5x
        continue;
      }

      if (this.mokka.state === states.FOLLOWER) {
        this.mokka.emit(eventTypes.HEARTBEAT_TIMEOUT);
        this.mokka.setState(states.FOLLOWER, this.mokka.term, null, null);
        await this.nodeApi.promote();
      }

      for (const node of this.mokka.nodes.values()) {
        const packet = this.messageApi.packet(messageTypes.ACK);
        await this.messageApi.message(packet, node.publicKey);
      }

      this.adjustmentDate = Date.now() + this.mokka.heartbeat;
    }

  }

  public setNextBeat(duration: number) {
    this.adjustmentDate = Date.now() + duration;
  }

  public timeout() {
    return this.mokka.heartbeat + Math.round(this.mokka.heartbeat * Math.random() * 0.5);
  }

}

export {HeartbeatController};
