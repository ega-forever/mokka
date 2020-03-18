const schnorr = require('bip-schnorr');
// const BigInteger = require('big-integer');
const ecurve = require('ecurve');
const convert = schnorr.convert;
const BigInteger = require('bigi'); //npm install --save bigi@1.1.0
const crypto = require('crypto');
const assert = require('assert');
//secp256k1
const curve = ecurve.getCurveByName('secp256k1');


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

    this.voteSession.pubKeyHash = schnorr.muSig.computeEll(this.publicKeys); // todo replace with merkle
    this.voteSession.pubKeyCombined = schnorr.muSig.pubKeyCombine(this.publicKeys, this.voteSession.pubKeyHash);
  }

  startVoting () {

    const payload = [];
    this.voteSession.message = convert.hash(Buffer.from('muSig is awesome!', 'utf8'));
    this.voteSession.term = 2;
    this.voteSession.nonce = Date.now();
    this.voteSession.nonceCombined = schnorr.muSig.sessionNonceCombine(this.voteSession, this.publicKeys.map((pubKey) => {
      const hash = crypto.createHmac('sha256', `${this.voteSession.term}:${pubKey.toString('hex')}:${this.voteSession.nonce}`).digest('hex');
      const sessionId = Buffer.from(hash, 'hex');
      const nonceData = Buffer.concat([sessionId, this.voteSession.message, this.voteSession.pubKeyCombined]);  // todo message should be replaced with part of SSS
      const secretNonce = convert.bufferToInt(convert.hash(nonceData));
      const R = curve.G.multiply(secretNonce);
      return convert.pointToBuffer(R);
    }));

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

    const nonceCombined = schnorr.muSig.sessionNonceCombine(this.voteSession, this.publicKeys.map((pubKey) => {
      const hash = crypto.createHmac('sha256', `${payload.term}:${pubKey.toString('hex')}:${payload.nonce}`).digest('hex');
      const sessionId = Buffer.from(hash, 'hex');
      const nonceData = Buffer.concat([sessionId, payload.message, this.voteSession.pubKeyCombined]);  // todo message should be replaced with part of SSS
      const secretNonce = convert.bufferToInt(convert.hash(nonceData));
      const R = curve.G.multiply(secretNonce);
      return convert.pointToBuffer(R);
    }));

    const coefficient = schnorr.muSig.computeCoefficient(this.voteSession.pubKeyHash, payload.index);
    const secretKey = this.privateKey.multiply(coefficient).mod(curve.n);

    const hash = crypto.createHmac('sha256', `${payload.term}:${this.publicKey.toString('hex')}:${payload.nonce}`).digest('hex');
    const sessionId = Buffer.from(hash, 'hex');
    const nonceData = Buffer.concat([sessionId, payload.message, this.voteSession.pubKeyCombined]);  // todo message should be replaced with part of SSS
    const secretNonce = convert.bufferToInt(convert.hash(nonceData));

    return  schnorr.muSig.partialSign({
      nonceIsNegated: this.voteSession.nonceIsNegated,
      secretKey,
      secretNonce
    }, payload.message, nonceCombined, this.voteSession.pubKeyCombined).toString(16);
  }

  collectVote (publicKey, signature) {

    const publicKeyIndex = this.publicKeys.findIndex(p => p.toString('hex') === publicKey);
    const hash = crypto.createHmac('sha256', `${this.voteSession.term}:${publicKey}:${this.voteSession.nonce}`).digest('hex');
    const sessionId = Buffer.from(hash, 'hex');
    const nonceData = Buffer.concat([sessionId, this.voteSession.message, this.voteSession.pubKeyCombined]);  // todo message should be replaced with part of SSS
    const secretNonce = convert.bufferToInt(convert.hash(nonceData));
    const R = curve.G.multiply(secretNonce);
    const nonce = convert.pointToBuffer(R);

    schnorr.muSig.partialSigVerify(
      {
        nonceIsNegated: this.voteSession.nonceIsNegated,
        pubKeyCombined: this.voteSession.pubKeyCombined,
        message: this.voteSession.message,
        ell: this.voteSession.pubKeyHash
      },
      BigInteger.fromHex(signature),
      this.voteSession.nonceCombined,
      publicKeyIndex,
      Buffer.from(publicKey, 'hex'),
      nonce
    );

    this.voteSession.replies.push(signature);

    if (this.publicKeys.length !== this.voteSession.replies.length)
      return;

    const fullSignature = schnorr.muSig.partialSigCombine(this.voteSession.nonceCombined, this.voteSession.replies.map(s=> BigInteger.fromHex(s)));
    schnorr.verify(this.voteSession.pubKeyCombined, this.voteSession.message, fullSignature);
    console.log('verified!');

  }

}


const publicKeys = [
  Buffer.from('03846f34fdb2345f4bf932cb4b7d278fb3af24f44224fb52ae551781c3a3cad68a', 'hex'),
  Buffer.from('02cd836b1d42c51d80cef695a14502c21d2c3c644bc82f6a7052eb29247cf61f4f', 'hex'),
  Buffer.from('03b8c1765111002f09ba35c468fab273798a9058d1f8a4e276f45a1f1481dd0bdb', 'hex')
];

const privateKeys = [
  BigInteger.fromHex('add2b25e2d356bec3770305391cbc80cab3a40057ad836bcb49ef3eed74a3fee'),
  BigInteger.fromHex('0a1645eef5a10e1f5011269abba9fd85c4f0cc70820d6f102fb7137f2988ad78'),
  BigInteger.fromHex('2031e7fed15c770519707bb092a6337215530e921ccea42030c15d86e8eaf0b8')
];

const leaderNode = new Node(publicKeys, privateKeys[0], publicKeys[0]);

const followerNodes = new Map();
followerNodes.set(publicKeys[1].toString('hex'), new Node(publicKeys, privateKeys[1], publicKeys[1]));
followerNodes.set(publicKeys[2].toString('hex'), new Node(publicKeys, privateKeys[2], publicKeys[2]));


const payloadsToSend = leaderNode.startVoting();


for (const payload of payloadsToSend) {
  const signature = followerNodes.get(payload.publicKey.toString('hex')).vote(payload);
  leaderNode.collectVote(payload.publicKey.toString('hex'), signature);
}

return;

// -----------------------------------------------------------------------
// Step 8: Verify individual partial signatures
// Every participant should verify the partial signatures received by the
// other participants.
// -----------------------------------------------------------------------

for (let i = 0; i < publicData.pubKeys.length; i++) {

  const hash = crypto.createHmac('sha256', `${term}:${publicData.pubKeys[i]}:${publicNonce}`).digest('hex');
  const sessionId = Buffer.from(hash, 'hex');
  const nonceData = Buffer.concat([sessionId, publicData.message, publicData.pubKeyCombined]);  // todo message should be replaced with part of SSS
  const secretNonce = convert.bufferToInt(convert.hash(nonceData));
  const R = curve.G.multiply(secretNonce);
  const nonce = convert.pointToBuffer(R);

  muSig.partialSigVerify(
    {
      nonceIsNegated: voteSession.nonceIsNegated,
      pubKeyCombined: publicData.pubKeyCombined,
      message: publicData.message,
      ell: publicData.pubKeyHash
    },
    publicData.partialSignatures[i],
    publicData.nonceCombined,
    i,
    publicData.pubKeys[i],
    nonce
  );
}


// -----------------------------------------------------------------------
// Step 9: Combine partial signatures
// Finally, the partial signatures can be combined into the full signature
// (s, R) that can be verified against combined public key P.
// -----------------------------------------------------------------------
publicData.signature = muSig.partialSigCombine(publicData.nonceCombined, publicData.partialSignatures);

// -----------------------------------------------------------------------
// Step 10: Verify signature
// The resulting signature can now be verified as a normal Schnorr
// signature (s, R) over the message m and public key P.
// -----------------------------------------------------------------------
schnorr.verify(publicData.pubKeyCombined, publicData.message, publicData.signature);