const schnorr = require('bip-schnorr');
const ecurve = require('ecurve');
const convert = schnorr.convert;
const BigInteger = require('bigi'); //npm install --save bigi@1.1.0
const curve = ecurve.getCurveByName('secp256k1');
const utils = require('./cryptoUtils');


class Node {

  constructor (publicKeys, privateKey, publicKey) {
    this.publicKeys = publicKeys;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.voteSession = {
      replies: [],
      pubKeyHash: null,
      pubKeyCombined: null,
      nonceIsNegated: false,
      term: 0,
      message: null,
      nonce: 0
    };

    this.voteSession.pubKeyHash = utils.buildMultiPublicKeyHash(this.publicKeys); // todo replace with merkle
    this.voteSession.pubKeyCombined = utils.buildMultiPublicKey(this.publicKeys);
  }

  startVoting () {

    const payload = [];
    this.voteSession.message = 'random message'.padEnd(32, '0');
    this.voteSession.term = 2;
    this.voteSession.nonce = Date.now();
    const {nonce: nonceCombined, nonceIsNegated} = utils.buildCombinedNonce(
      this.voteSession.term,
      this.publicKeys,
      this.voteSession.pubKeyCombined,
      this.voteSession.nonce,
      this.voteSession.message
    );

    this.voteSession.nonceCombined = nonceCombined;
    this.voteSession.nonceIsNegated = nonceIsNegated;

    for (let i = 0; i < this.publicKeys.length; i++) {
      if (this.publicKeys[i].toString('hex') === this.publicKey.toString('hex')) {
        const selfVote = this.vote({
          publicKey: this.publicKeys[i],
          term: this.voteSession.term,
          message: this.voteSession.message,
          index: i,
          nonce: this.voteSession.nonce
        });

        this.voteSession.replies.push(selfVote);
        continue
      }

      payload.push({
        publicKey: this.publicKeys[i],
        term: this.voteSession.term,
        message: this.voteSession.message,
        index: i, // todo randomize index by shuffling the public keys order
        nonce: this.voteSession.nonce
      });
    }

    return payload;
  }

  vote (payload) {

    const {nonce: nonceCombined, nonceIsNegated} = utils.buildCombinedNonce(
      payload.term,
      this.publicKeys,
      this.voteSession.pubKeyCombined,
      payload.nonce,
      payload.message
    );

    return utils.partialSign(
      payload.term,
      payload.message,
      payload.nonce,
      this.privateKey,
      this.publicKey,
      payload.index,
      nonceCombined,
      this.voteSession.pubKeyCombined,
      this.voteSession.pubKeyHash,
      nonceIsNegated
    );
  }

  collectVote (publicKey, signature) {

    const publicKeyIndex = this.publicKeys.findIndex(p => p.toString('hex') === publicKey);

    const secretNonce = utils.buildNonce(this.voteSession.term, publicKey, this.voteSession.nonce, this.voteSession.message, this.voteSession.pubKeyCombined);
    const R = curve.G.multiply(BigInteger.fromHex(secretNonce));
    const nonce = convert.pointToBuffer(R).toString('hex');

    utils.partialSigVerify(
      this.voteSession.message,
      this.voteSession.pubKeyCombined,
      this.voteSession.pubKeyHash,
      signature,
      this.voteSession.nonceCombined,
      publicKeyIndex,
      publicKey,
      nonce,
      this.voteSession.nonceIsNegated
    );

    this.voteSession.replies.push(signature);

    if (this.publicKeys.length !== this.voteSession.replies.length)
      return;

    const fullSignature = utils.partialSigCombine(this.voteSession.nonceCombined, this.voteSession.replies);
    utils.verify(Buffer.from(this.voteSession.pubKeyCombined, 'hex'), Buffer.from(this.voteSession.message), fullSignature);
    console.log('verified!');

  }

}


const publicKeys = [
  '03846f34fdb2345f4bf932cb4b7d278fb3af24f44224fb52ae551781c3a3cad68a',
  '02cd836b1d42c51d80cef695a14502c21d2c3c644bc82f6a7052eb29247cf61f4f',
  '03b8c1765111002f09ba35c468fab273798a9058d1f8a4e276f45a1f1481dd0bdb'
];

const privateKeys = [
  'add2b25e2d356bec3770305391cbc80cab3a40057ad836bcb49ef3eed74a3fee',
  '0a1645eef5a10e1f5011269abba9fd85c4f0cc70820d6f102fb7137f2988ad78',
  '2031e7fed15c770519707bb092a6337215530e921ccea42030c15d86e8eaf0b8'
];

const leaderNode = new Node(publicKeys, privateKeys[0], publicKeys[0]);

const followerNodes = new Map();
followerNodes.set(publicKeys[1], new Node(publicKeys, privateKeys[1], publicKeys[1]));
followerNodes.set(publicKeys[2], new Node(publicKeys, privateKeys[2], publicKeys[2]));


const payloadsToSend = leaderNode.startVoting();


for (const payload of payloadsToSend) {
  const signature = followerNodes.get(payload.publicKey).vote(payload);
  leaderNode.collectVote(payload.publicKey, signature);
}

return;