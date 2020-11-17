class VoteModel {

  private readonly messageNonce: number;
  private readonly publicKeyToNonceMap: Map<string, { as: string[], combination: string[], e: string, nonce: number }>;
  private readonly replies: Map<string, Map<string, string>>;

  constructor(
    messageNonce: number
  ) {
    this.messageNonce = messageNonce;
    this.publicKeyToNonceMap = new Map<string, { as: string[], combination: string[], e: string, nonce: number }>();
    this.replies = new Map<string, Map<string, string>>();
  }

  get publicKeyToNonce(): Map<string, { as: string[], combination: string[], e: string, nonce: number }> {
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
