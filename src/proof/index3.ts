import assert from 'assert';
import * as BigInteger from 'bigi';
import * as crypto from 'crypto';
import * as ecurve from 'ecurve';
import * as utilsNew from './cryptoUtils';
import * as utils from './cryptoUtils2';
import {getCombinations} from './utils';

const curve = ecurve.getCurveByName('secp256k1');

class Node {

  private readonly peerPublicKeys: string[];
  private readonly multiPublicKeyToPublicKeyHashAndPairsMap: Map<string, { hash: string, pairs: string[] }>;
  private readonly ownPair: {
    publicKey: string,
    privateKey: string
  };
  private term: number;
  private readonly voteSession: {
    messageNonce: number,
    publicKeyToNonceMap: Map<string, { nonce: string, nonceIsNegated: boolean }>,
    replies: Map<string, Map<string, string>>,
    expireIn: number
  };

  constructor(peerPublicKeys: string[], privateKey: string, publicKey: string) {
    this.multiPublicKeyToPublicKeyHashAndPairsMap = new Map<string, { hash: string, pairs: string[] }>();
    this.peerPublicKeys = peerPublicKeys;
    this.ownPair = {
      privateKey,
      publicKey
    };

    this.term = 12;

    this.voteSession = {
      expireIn: 1000,
      messageNonce: null,
      publicKeyToNonceMap: new Map<string, { nonce: string, nonceIsNegated: boolean }>(),
      replies: new Map<string, Map<string, string>>()
    };

    const sortedPublicKeys = [...peerPublicKeys, publicKey].sort();
    const quorum = Math.floor(sortedPublicKeys.length / 2) + 1;

    const combinations = getCombinations([publicKey, ...peerPublicKeys].sort(), quorum);
    for (const combination of combinations) {

      if (!combination.includes(publicKey)) {
        continue;
      }

      const pubKeyHash = utilsNew.buildMultiPublicKeyHash(combination);
      const pubKeyCombined = utilsNew.buildMultiPublicKey(combination);

      this.multiPublicKeyToPublicKeyHashAndPairsMap.set(pubKeyCombined, {
        hash: pubKeyHash,
        pairs: combination
      });
    }
  }

  public startVoting(): Array<{ nonce: number, publicKey: string, term: number }> {

    const payload: Array<{ nonce: number, publicKey: string, term: number }> = [];
    this.voteSession.messageNonce = Date.now();

    for (const publicKeyCombined of this.multiPublicKeyToPublicKeyHashAndPairsMap.keys()) {
      const publicKeysInvolved = this.multiPublicKeyToPublicKeyHashAndPairsMap.get(publicKeyCombined).pairs;

      const {nonce: nonceCombined, nonceIsNegated: nonceIsNegated} = utilsNew.buildCombinedNonce(
        this.term,
        this.voteSession.messageNonce,
        publicKeysInvolved,
        publicKeyCombined
      );

      this.voteSession.publicKeyToNonceMap.set(publicKeyCombined, {
        nonce: nonceCombined,
        nonceIsNegated
      });
    }

    for (const publicKey of [...this.peerPublicKeys, this.ownPair.publicKey]) {
      const votePayload = {
        nonce: this.voteSession.messageNonce,
        publicKey,
        term: this.term
      };

      // todo there may be a pair where my own key is not present
      if (publicKey === this.ownPair.publicKey) { // todo should work for all possible nonces
        const selfVote = this.vote(publicKey, votePayload);
        for (const multiPublicKey of this.voteSession.publicKeyToNonceMap.keys()) {
          if (!this.voteSession.replies.has(multiPublicKey)) {
            this.voteSession.replies.set(multiPublicKey, new Map<string, string>());
          }

          if (selfVote.has(multiPublicKey)) {
            this.voteSession.replies.get(multiPublicKey).set(publicKey, selfVote.get(multiPublicKey));
          }
        }
        continue;
      }

      payload.push(votePayload);
    }

    return payload;
  }

  public vote(
    candidatePublicKey: string,
    payload: { nonce: number, term: number }): Map<string, string> {

    assert(Date.now() - payload.nonce < this.voteSession.expireIn);

    const multiPublicKeyToSigMap: Map<string, string> = new Map<string, string>();

    for (const publicKeyCombined of this.multiPublicKeyToPublicKeyHashAndPairsMap.keys()) {
      const multiPublicKeyData = this.multiPublicKeyToPublicKeyHashAndPairsMap.get(publicKeyCombined);

      if (!multiPublicKeyData.pairs.includes(candidatePublicKey)) {
        continue;
      }

      const {nonce: nonceCombined, nonceIsNegated} = utilsNew.buildCombinedNonce(
        this.term,
        payload.nonce,
        multiPublicKeyData.pairs,
        publicKeyCombined
      );

      this.voteSession.publicKeyToNonceMap.set(publicKeyCombined, {
        nonce: nonceCombined,
        nonceIsNegated
      });

      const sig = utilsNew.partialSign(
        payload.term,
        payload.nonce,
        this.ownPair.privateKey,
        this.ownPair.publicKey,
        multiPublicKeyData.pairs.indexOf(this.ownPair.publicKey),
        nonceCombined,
        publicKeyCombined,
        multiPublicKeyData.hash,
        nonceIsNegated
      );

      multiPublicKeyToSigMap.set(publicKeyCombined, sig);
    }

    return multiPublicKeyToSigMap;
  }

  public collectVote(publicKey: string, signaturesMap: Map<string, string>) {

    for (const multiPublicKey of this.voteSession.publicKeyToNonceMap.keys()) {
      const nonceData = this.voteSession.publicKeyToNonceMap.get(multiPublicKey);
      const publicKeyData = this.multiPublicKeyToPublicKeyHashAndPairsMap.get(multiPublicKey);

      if (!signaturesMap.has(multiPublicKey)) {
        continue;
      }

      const signature = signaturesMap.get(multiPublicKey);

      const isValid = utilsNew.partialSigVerify(
        this.term,
        this.voteSession.messageNonce,
        multiPublicKey,
        publicKeyData.hash,
        signature,
        nonceData.nonce,
        publicKeyData.pairs.indexOf(publicKey),
        publicKey,
        nonceData.nonceIsNegated
      );

      if (!isValid) { // todo should be treated as error
        return;
      }

      if (!this.voteSession.replies.has(multiPublicKey)) {
        this.voteSession.replies.set(multiPublicKey, new Map<string, string>());
      }

      this.voteSession.replies.get(multiPublicKey).set(publicKey, signature);
    }

    const quorum = Math.floor((this.peerPublicKeys.length + 1) / 2) + 1;

    const multiKeyInQuorum = Array.from(this.voteSession.replies.keys())
      .find((multiKey) =>
        this.voteSession.replies.has(multiKey) && this.voteSession.replies.get(multiKey).size >= quorum
      );

    if (!multiKeyInQuorum)
      return;

    const nonceCombined = this.voteSession.publicKeyToNonceMap.get(multiKeyInQuorum).nonce;

    const fullSignature = utilsNew.partialSigCombine(
      nonceCombined,
      Array.from(this.voteSession.replies.get(multiKeyInQuorum).values())
    );

    const isValid = utilsNew.verify(this.term, this.voteSession.messageNonce, multiKeyInQuorum, fullSignature);

    console.log('verified status: ', isValid);
    if (!isValid) {
      console.log(this.term, this.voteSession.messageNonce);
    }

    // todo check on follower side: signature, message, round (nonce)
  }

}

const privateKeys = [];

for (let i = 0; i < 3; i++) {
  const privateKey = crypto.createHmac('sha256', `${Date.now() + Math.random()}`).digest('hex').substr(0, 32);
  privateKeys.push(privateKey);
}

const publicKeys = privateKeys.map((pk) => curve.G.multiply(BigInteger.fromHex(pk)).getEncoded(true).toString('hex'));

console.log(privateKeys);
console.log(publicKeys);

const leaderNode = new Node(publicKeys.filter((pk) => pk !== publicKeys[0]), privateKeys[0], publicKeys[0]);

const followerNodes = new Map();
// tslint:disable-next-line:max-line-length
followerNodes.set(publicKeys[1], new Node(publicKeys.filter((pk) => pk !== publicKeys[1]), privateKeys[1], publicKeys[1]));
// tslint:disable-next-line:max-line-length
followerNodes.set(publicKeys[2], new Node(publicKeys.filter((pk) => pk !== publicKeys[2]), privateKeys[2], publicKeys[2]));

const start = Date.now();

const payloadsToSend = leaderNode.startVoting();

for (const payload of payloadsToSend) {
  const signaturesMap = followerNodes.get(payload.publicKey).vote(publicKeys[0], payload);
  leaderNode.collectVote(payload.publicKey, signaturesMap);
}
console.log(`processed in ${Date.now() - start}`);
