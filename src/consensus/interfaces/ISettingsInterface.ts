import {PacketModel} from '../models/PacketModel';

export interface ISettingsInterface {
  privateKey: string;
  address: string;
  heartbeat: number;
  proofExpiration: number;
  customVoteRule?: (packet: PacketModel) => Promise<boolean>;
  reqMiddleware?: (packet: PacketModel) => Promise<PacketModel>;
  resMiddleware?: (packet: PacketModel, peerPublicKey: string) => Promise<PacketModel>;
  logger: {
    error: () => void,
    info: () => void,
    trace: () => void
  };
}
