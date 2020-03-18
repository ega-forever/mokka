const schnorr = require('bip-schnorr');
// const BigInteger = require('big-integer');
const ecurve = require('ecurve');
const convert = schnorr.convert;
const randomBytes = require('randombytes');
const BigInteger = require('bigi'); //npm install --save bigi@1.1.0
const crypto = require('crypto');
const assert = require('assert');
//secp256k1
const curve = ecurve.getCurveByName('secp256k1');


const randomBuffer = (len) => Buffer.from(randomBytes(len));
const muSig = schnorr.muSig;

// data known to every participant
const publicData = {
  pubKeys: [
    Buffer.from('03846f34fdb2345f4bf932cb4b7d278fb3af24f44224fb52ae551781c3a3cad68a', 'hex'),
    Buffer.from('02cd836b1d42c51d80cef695a14502c21d2c3c644bc82f6a7052eb29247cf61f4f', 'hex'),
    Buffer.from('03b8c1765111002f09ba35c468fab273798a9058d1f8a4e276f45a1f1481dd0bdb', 'hex')
  ],
  message: convert.hash(Buffer.from('muSig is awesome!', 'utf8')),
  pubKeyHash: null,
  pubKeyCombined: null,
  nonces: [],
  nonceCombined: null,
  partialSignatures: [],
  signature: null
};

// data only known by the individual party, these values are never shared
// between the signers!
const signerPrivateData = [
  // signer 1
  {
    privateKey: BigInteger.fromHex('add2b25e2d356bec3770305391cbc80cab3a40057ad836bcb49ef3eed74a3fee'),
    session: null
  },
  // signer 2
  {
    privateKey: BigInteger.fromHex('0a1645eef5a10e1f5011269abba9fd85c4f0cc70820d6f102fb7137f2988ad78'),
    session: null
  },
  // signer 3
  {
    privateKey: BigInteger.fromHex('2031e7fed15c770519707bb092a6337215530e921ccea42030c15d86e8eaf0b8'),
    session: null
  }
];


publicData.pubKeyHash = muSig.computeEll(publicData.pubKeys);
publicData.pubKeyCombined = muSig.pubKeyCombine(publicData.pubKeys, publicData.pubKeyHash);

const publicNonce = Date.now();
const term = 2;

const voteSession = {nonceIsNegated: false};

publicData.nonceCombined = muSig.sessionNonceCombine(voteSession, publicData.pubKeys.map((pubKey) => {
  const hash = crypto.createHmac('sha256', `${term}:${pubKey}:${publicNonce}`).digest('hex');
  const sessionId = Buffer.from(hash, 'hex');
  const nonceData = Buffer.concat([sessionId, publicData.message, publicData.pubKeyCombined]);  // todo message should be replaced with part of SSS
  const secretNonce = convert.bufferToInt(convert.hash(nonceData));
  const R = curve.G.multiply(secretNonce);
  const nonce = convert.pointToBuffer(R);
  return nonce;
}));

// -----------------------------------------------------------------------
// Step 6: Generate partial signatures
// Every participant can now create their partial signature s_i over the
// given message.
// -----------------------------------------------------------------------
signerPrivateData.forEach((data, index) => {
  const hash = crypto.createHmac('sha256', `${term}:${publicData.pubKeys[index]}:${publicNonce}`).digest('hex');
  const sessionId = Buffer.from(hash, 'hex');
  const nonceData = Buffer.concat([sessionId, publicData.message, publicData.pubKeyCombined]);  // todo message should be replaced with part of SSS
  const secretNonce = convert.bufferToInt(convert.hash(nonceData));

  const coefficient = muSig.computeCoefficient(publicData.pubKeyHash, index);
  const secretKey = data.privateKey.multiply(coefficient).mod(curve.n);

  data.session = {
    partialSignature: muSig.partialSign({
      nonceIsNegated: voteSession.nonceIsNegated,
      secretKey,
      secretNonce
    }, publicData.message, publicData.nonceCombined, publicData.pubKeyCombined)
  }
});

// -----------------------------------------------------------------------
// Step 7: Exchange partial signatures (communication round 3)
// The partial signature of each signer is exchanged with the other
// participants. Simulated here by copying.
// -----------------------------------------------------------------------
for (let i = 0; i < publicData.pubKeys.length; i++) {
  publicData.partialSignatures[i] = signerPrivateData[i].session.partialSignature;
}

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

  console.log({
      nonceIsNegated: voteSession.nonceIsNegated,
      pubKeyCombined: publicData.pubKeyCombined,
      message: publicData.message,
      ell: publicData.pubKeyHash
    },
    publicData.partialSignatures[i],
    publicData.nonceCombined,
    i,
    publicData.pubKeys[i],
    nonce)

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