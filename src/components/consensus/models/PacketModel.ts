class PacketModel {

  public state: number;
  public term: number;
  public publicKey: string;
  public type: number;
  public data: any;
  public last: {
    index: number,
    hash: string,
    term: number,
    createdAt: number,
    responses: string[]
  };
  public proof: string;

  constructor(
    type: number,
    state: number,
    term: number,
    publicKey: string,
    last: {
      index: number,
      hash: string,
      term: number,
      createdAt: number,
      responses: string[]
    },
    proof: string,
    data: any = null) {
    this.state = state;
    this.type = type;
    this.term = term;
    this.publicKey = publicKey;
    this.last = last;
    this.data = data;
    this.proof = proof;
  }

}

export {PacketModel};
