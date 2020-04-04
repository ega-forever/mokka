import {PacketModel} from '../models/PacketModel';

export interface ISettingsInterface {
  privateKey: string;
  address: string;
  heartbeat: number;
  proofExpiration: number;
  reqMiddleware?: (packet: PacketModel) => Promise<PacketModel>;
  resMiddleware?: (packet: PacketModel) => Promise<PacketModel>;
  logger: {
    error: () => void,
    info: () => void,
    trace: () => void
  };
}
