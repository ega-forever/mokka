class VoteModel {

  private readonly messageNonce: number;
  private readonly messageSecret: string;
  private readonly replies: Map<string, string>;

  constructor(
    messageNonce: number,
    secret: string
  ) {
    this.messageNonce = messageNonce;
    this.replies = new Map<string, string>();
    this.messageSecret = secret;
  }

  get peerReplies(): Map<string, string> {
    return this.replies;
  }

  get nonce(): number {
    return this.messageNonce;
  }

  get secret(): string {
    return this.messageSecret;
  }
}

export {VoteModel};
