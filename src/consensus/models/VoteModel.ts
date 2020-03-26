class VoteModel {

  private readonly messageNonce: number;
  private readonly publicKeyToNonceMap: Map<string, { nonce: string, nonceIsNegated: boolean }>;
  private readonly replies: Map<string, Map<string, string>>;
  private readonly expireIn: number;

  constructor(
    messageNonce: number,
    expireIn: number
  ) {
    this.messageNonce = messageNonce;
    this.expireIn = expireIn;
    this.publicKeyToNonceMap = new Map<string, { nonce: string, nonceIsNegated: boolean }>();
    this.replies = new Map<string, Map<string, string>>();
  }

  get expiration(): number {
    return this.expireIn;
  }

  get publicKeyToNonce(): Map<string, { nonce: string, nonceIsNegated: boolean }> {
    return this.publicKeyToNonceMap;
  }

  get peerReplies(): Map<string, Map<string, string>> {
    return this.replies;
  }

  get nonce(): number {
    return this.messageNonce;
  }

}

export {VoteModel};
