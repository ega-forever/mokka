import { MessageApi } from '../api/MessageApi';
import { NodeApi } from '../api/NodeApi';
import eventTypes from '../constants/EventTypes';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import NodeStates from '../constants/NodeStates';
import { Mokka } from '../main';

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

      if (
        this.mokka.state === states.FOLLOWER ||
        // tslint:disable-next-line:max-line-length
        (this.mokka.state === states.LEADER && this.mokka.getProofMintedTime() + this.mokka.proofExpiration < Date.now())
      ) {
        this.mokka.emit(eventTypes.HEARTBEAT_TIMEOUT);
        this.mokka.setState(states.FOLLOWER, this.mokka.term, null, null);
        await this.nodeApi.promote();
        if (this.mokka.state === NodeStates.FOLLOWER) {
          this.setNextBeat(Math.round(this.mokka.electionTimeout * (1 + 2 * Math.random())));
          continue;
        }
      }

      this.mokka.logger.trace(`sending ack signal to peers`);
      await Promise.all(
        [...this.mokka.nodes.values()].map((node) => {
          const packet = this.messageApi.packet(messageTypes.ACK);
          return this.messageApi.message(packet, node.publicKey);
        }));

      this.mokka.logger.trace(`sent ack signal to peers`);
      this.adjustmentDate = Date.now() + this.mokka.heartbeat;
    }

  }

  public setNextBeat(duration: number) {
    this.mokka.logger.trace(`set next beat in ${ duration }`);
    this.adjustmentDate = Date.now() + duration;
  }

  public timeout() {
    return this.safeHeartbeat() + Math.round(this.mokka.heartbeat * Math.random());
  }

  public safeHeartbeat() {
    return this.mokka.heartbeat * 1.5;
  }

}

export { HeartbeatController };
