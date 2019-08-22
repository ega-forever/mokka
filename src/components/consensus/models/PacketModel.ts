class PacketModel {

  public state: number;
  public term: number;
  public publicKey: string;
  public type: number;
  public data: any;
  public peer: {
    publicKey: string;
    number: number;
  };
  public last: {
    index: number,
    hash: string,
    term: number,
    createdAt: number
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
      createdAt: number
    },
    proof: string,
    peer: {
      publicKey: string,
      number: number
    },
    data: any = null) {
    this.state = state;
    this.type = type;
    this.term = term;
    this.publicKey = publicKey;
    this.last = last;
    this.data = data;
    this.peer = peer;
    this.proof = proof;
  }

  public compact() {
    // todo remove peer.publicKey
  }

}

export {PacketModel};
