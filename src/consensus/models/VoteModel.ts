class VoteModel {

  public readonly nonce: number;
  public readonly term: number;
  public readonly publicKeysRootForTerm: string;
  public readonly publicKeyToCombinationMap: Map<string, string[]>;
  public readonly repliesPublicKeyToSignatureMap: Map<string, string>;

  constructor(
    nonce: number,
    term: number,
    publicKeysRootForTerm: string
  ) {
    this.nonce = nonce;
    this.publicKeysRootForTerm = publicKeysRootForTerm;
    this.publicKeyToCombinationMap = new Map<string, string[]>();
    this.repliesPublicKeyToSignatureMap = new Map<string, string>();
  }

}

export {VoteModel};
