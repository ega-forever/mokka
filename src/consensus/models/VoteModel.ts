class VoteModel {

  public readonly nonce: number;
  public readonly sharedPublicKey: string;
  public readonly publicKeyToCombinationMap: Map<string, string[]>;
  public readonly repliesPublicKeyToSignatureMap: Map<string, string>;

  constructor(
    nonce: number,
    sharedPublicKey: string
  ) {
    this.nonce = nonce;
    this.sharedPublicKey = sharedPublicKey;
    this.publicKeyToCombinationMap = new Map<string, string[]>();
    this.repliesPublicKeyToSignatureMap = new Map<string, string>();
  }

}

export {VoteModel};
