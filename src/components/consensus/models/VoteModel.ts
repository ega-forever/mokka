class VoteModel {

  private _candidate: string;
  private _shares: Array<{ share: string, publicKey: string, voted: boolean, signature: string }>;
  private _secret: string; // todo remove - use last index instead
  private _started: number;

  constructor(
    candidate: string = null,
    shares: Array<{ share: string, publicKey: string, voted: boolean, signature: string }> = null,
    secret: string = null,
    started: number = null
  ) {
    this._candidate = candidate;
    this._shares = shares;
    this._secret = secret;
    this._started = started;
  }

  get started(): number {
    return this._started;
  }

  get secret(): string {
    return this._secret;
  }

  get shares(): Array<{ share: string, publicKey: string, voted: boolean, signature: string }> {
    return this._shares;
  }

  get candidate(): string {
    return this._candidate;
  }

}

export {VoteModel};
