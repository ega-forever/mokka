class VoteModel {

  private readonly messageNonce: number;
  private readonly publicKeyToNonceMap: Map<string, { nonce: string, nonceIsNegated: boolean }>;
  private readonly replies: Map<string, Map<string, string>>;

  constructor(
    messageNonce: number
  ) {
    this.messageNonce = messageNonce;
    this.publicKeyToNonceMap = new Map<string, { nonce: string, nonceIsNegated: boolean }>();
    this.replies = new Map<string, Map<string, string>>();
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
