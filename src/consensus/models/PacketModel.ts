class PacketModel {

  public state: number;
  public term: number;
  public publicKey: string;
  public type: number;
  public data: any;
  public proof: string;

  constructor(
    type: number,
    state: number,
    term: number,
    publicKey: string,
    proof: string,
    data: any = null) {
    this.state = state;
    this.type = type;
    this.term = term;
    this.publicKey = publicKey;
    this.data = data;
    this.proof = proof;
  }

  public compact() {
    // todo remove peer.publicKey
  }

}

export {PacketModel};
