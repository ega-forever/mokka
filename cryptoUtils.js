const schnorr = require('bip-schnorr');
const ecurve = require('ecurve');
const convert = schnorr.convert;
const crypto = require('crypto');
const curve = ecurve.getCurveByName('secp256k1');
const math = require('bip-schnorr/src/math');
const BigInteger = require('bigi'); //npm install --save bigi@1.1.0


const buildNonce = (term, publicKeyHex, nonce, messageStr, pubKeyCombinedHex) => {
  const hash = crypto.createHmac('sha256', `${term}:${publicKeyHex}:${nonce}`).digest('hex');
  const sessionId = Buffer.from(hash, 'hex');
  const nonceData = Buffer.concat([sessionId, Buffer.from(messageStr), Buffer.from(pubKeyCombinedHex, 'hex')]);  // todo message should be replaced with part of SSS
  return crypto.createHash('sha256')
    .update(nonceData)
    .digest('hex');
};

const buildCombinedNonce = (term, publicKeysHex, pubKeyCombinedHex, nonce, messageStr) => {

  const nonces = publicKeysHex.map(publicKey => {
    const secretNonce = buildNonce(term, publicKey, nonce, messageStr, pubKeyCombinedHex);
    const R = curve.G.multiply(BigInteger.fromHex(secretNonce));
    return convert.pointToBuffer(R);
  });

  let nonceIsNegated = false;

  let R = convert.pubKeyToPoint(nonces[0]);
  for (let i = 1; i < nonces.length; i++) {
    R = R.add(convert.pubKeyToPoint(nonces[i]));
  }
  if (math.jacobi(R.affineY) !== 1) {
    nonceIsNegated = true;
    R = R.negate();
  }
  return {nonce: convert.pointToBuffer(R).toString('hex'), nonceIsNegated};
};

const buildMultiPublicKeyHash = (publicKeysHex) => { // todo sort
  return crypto.createHash('sha256')
    .update(Buffer.concat(publicKeysHex.map(k => Buffer.from(k, 'hex'))))
    .digest('hex');
};

const buildMultiPublicKey = (orderedPublicKeysHex) => { // todo sort
  const publicKeysHash = buildMultiPublicKeyHash(orderedPublicKeysHex);
  let X = null;
  for (let i = 0; i < orderedPublicKeysHex.length; i++) {
    const Xi = convert.pubKeyToPoint(Buffer.from(orderedPublicKeysHex[i], 'hex'));
    const coefficient = computeCoefficient(Buffer.from(publicKeysHash, 'hex'), i);
    const summand = Xi.multiply(BigInteger.fromHex(coefficient));
    if (X === null) {
      X = summand;
    } else {
      X = X.add(summand);
    }
  }
  return convert.pointToBuffer(X);

};

const computeCoefficient = (publicKeyHashHex, index) => {
  const MUSIG_TAG = crypto.createHash('sha256')
    .update(Buffer.from('MuSig coefficient')) // todo why this coef?
    .digest('hex');

  const idxBuf = Buffer.alloc(4);
  idxBuf.writeUInt32LE(index);
  const data = Buffer.concat([
    Buffer.from(MUSIG_TAG, 'hex'),
    Buffer.from(MUSIG_TAG, 'hex'),
    Buffer.from(publicKeyHashHex, 'hex'),
    idxBuf
  ]);

  const hash = crypto.createHash('sha256')
    .update(data) // todo why this coef?
    .digest('hex');

  return BigInteger.fromHex(hash).mod(curve.n).toString(16);
};

const partialSign = (term, message, nonce, privateKeyHex, publicKeyHex, index, nonceCombinedHex, pubKeyCombinedHex, pubKeyCombinedHashHex, nonceIsNegated) => {

  const coefficient = computeCoefficient(pubKeyCombinedHashHex, index);
  const secretKey = BigInteger.fromHex(privateKeyHex).multiply(BigInteger.fromHex(coefficient)).mod(curve.n);
  const secretNonce = buildNonce(term, publicKeyHex, nonce, message, pubKeyCombinedHex);


  const R = convert.pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const Rx = convert.intToBuffer(R.affineX);
  const e = math.getE(Rx, convert.pubKeyToPoint(Buffer.from(pubKeyCombinedHex, 'hex')), Buffer.from(message));
  let k = BigInteger.fromHex(secretNonce);
  if (nonceIsNegated) {
    k = k.negate();
  }
  return secretKey.multiply(e).mod(curve.n).add(k).mod(curve.n).toString(16);
};

const partialSigVerify = (term, message, messageNonce, pubKeyCombinedHex, pubKeyCombinedHashHex, partialSigHex, nonceCombinedHex, index, pubKeyHex, nonceIsNegated) => {

  const secretNonce = buildNonce(term, pubKeyHex, messageNonce, message, pubKeyCombinedHex);
  const RNonce = curve.G.multiply(BigInteger.fromHex(secretNonce));
  const nonce = convert.pointToBuffer(RNonce);


  const R = convert.pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const Rx = convert.intToBuffer(R.affineX);
  const e = math.getE(Rx, convert.pubKeyToPoint(Buffer.from(pubKeyCombinedHex, 'hex')), Buffer.from(message));
  const coefficient = computeCoefficient(pubKeyCombinedHashHex, index);
  const Ri = convert.pubKeyToPoint(nonce);
  let RP = math.getR(
    BigInteger.fromHex(partialSigHex),
    e.multiply(BigInteger.fromHex(coefficient)).mod(curve.n),
    convert.pubKeyToPoint(Buffer.from(pubKeyHex, 'hex')));
  if (!nonceIsNegated) {
    RP = RP.negate();
  }
  const sum = RP.add(Ri);
  if (!sum.curve.isInfinity(sum)) {
    throw new Error('partial signature verification failed');
  }
};

const partialSigCombine = (nonceCombinedHex, partialSigsHex) => {
  const R = convert.pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const Rx = convert.intToBuffer(R.affineX);
  let s = BigInteger.fromHex(partialSigsHex[0]);
  for (let i = 1; i < partialSigsHex.length; i++) {
    s = s.add(BigInteger.fromHex(partialSigsHex[i], 'hex')).mod(curve.n);
  }
  return Buffer.concat([Rx, convert.intToBuffer(s)]);
};

const verify = (pubKeyHex, message, signatureHex) => {
  const P = convert.pubKeyToPoint(Buffer.from(pubKeyHex, 'hex'));
  const r = convert.bufferToInt(Buffer.from(signatureHex, 'hex').slice(0, 32));
  const s = convert.bufferToInt(Buffer.from(signatureHex, 'hex').slice(32, 64));
  const e = math.getE(convert.intToBuffer(r), P, message);
  const R = math.getR(s, e, P);
  if (R.curve.isInfinity(R) || math.jacobi(R.affineY) !== 1 || !R.affineX.equals(r)) {
    throw new Error('signature verification failed');
  }
};

module.exports = {
  buildCombinedNonce,
  buildMultiPublicKeyHash,
  buildMultiPublicKey,
  buildNonce,
  computeCoefficient,
  partialSign,
  partialSigVerify,
  partialSigCombine,
  verify
};
