class VoteModel {

  private readonly messageNonce: number;
  private readonly replies: Map<string, {x: string, y: string}>;

  constructor(
    messageNonce: number
  ) {
    this.messageNonce = messageNonce;
    this.replies = new Map<string, {x: string, y: string}>();
  }

  get peerReplies(): Map<string, {x: string, y: string}> {
    return this.replies;
  }

  get nonce(): number {
    return this.messageNonce;
  }

}

export {VoteModel};
