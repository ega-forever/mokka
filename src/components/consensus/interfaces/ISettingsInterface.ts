import {IStorageInterface} from '../../storage/interfaces/IStorageInterface';

export interface ISettingsInterface {
  electionMax: number;
  electionMin: number;
  privateKey: string;
  address: string;
  heartbeat: number;
  proofExpiration: number;
  logger: {
    error: () => void,
    info: () => void,
    trace: () => void
  };
  storage?: IStorageInterface;
  gossipHeartbeat: number;
}
