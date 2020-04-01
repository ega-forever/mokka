import {NodeModel} from '../models/NodeModel';
import {PacketModel} from '../models/PacketModel';

export interface ISettingsInterface {
  privateKey: string;
  address: string;
  heartbeat: number;
  proofExpiration: number;
  commandMiddleware?: (packet: PacketModel, node: NodeModel) => Promise<PacketModel[]>;
  logger: {
    error: () => void,
    info: () => void,
    trace: () => void
  };
}
