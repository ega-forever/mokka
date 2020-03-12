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
  gossipHeartbeat: number;
}
