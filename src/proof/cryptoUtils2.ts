import * as BigInteger from 'bigi';
import * as math from 'bip-schnorr/src/math';
import * as crypto from 'crypto';
import * as ecurve from 'ecurve';

const curve = ecurve.getCurveByName('secp256k1');

export const buildNonce = (
  term: number,
  messageNonce: number,
  publicKeyHex: string,
  pubKeyCombinedHex: string) => {
  const hash = crypto.createHmac('sha256', `${term}:${messageNonce}:${publicKeyHex}`).digest('hex');
  const sessionId = Buffer.from(hash, 'hex');
  const nonceData = Buffer.concat([
    sessionId,
    Buffer.from(pubKeyCombinedHex, 'hex')
  ]);  // todo message should be replaced with part of SSS
  return crypto.createHash('sha256')
    .update(nonceData)
    .digest('hex');
};

export const buildCombinedNonce = (
  term: number,
  messageNonce: number,
  publicKeysHex: string[],
  pubKeyCombinedHex: string,
  partial: boolean = false
): { nonce: string, nonceIsNegated: boolean } => {

  const nonces = publicKeysHex.map((publicKey) => {
    const secretNonce = buildNonce(term, messageNonce, publicKey, pubKeyCombinedHex);
    const R = curve.G.multiply(BigInteger.fromHex(secretNonce));
    return R.getEncoded(true);
  });

  let nonceIsNegated = false;

  let R = pubKeyToPoint(nonces[0]);
  for (let i = 1; i < nonces.length; i++) {
    R = R.add(pubKeyToPoint(nonces[i]));
  }

  if (math.jacobi(R.affineY) !== 1 && !partial) {
    nonceIsNegated = true;
    R = R.negate();
  }

  return {nonce: R.getEncoded(!partial).toString('hex'), nonceIsNegated};
};

export const buildPartialCombinedNonce = (
  partialCombinedNonceHex: string,
  term: number,
  messageNonce: number,
  publicKeyHex: string,
  pubKeyCombinedHex: string) => {

  const secretNonce = buildNonce(term, messageNonce, publicKeyHex, pubKeyCombinedHex);
  const nonce = curve.G.multiply(BigInteger.fromHex(secretNonce)).getEncoded(true);

  let nonceIsNegated = false;

  let R = ecurve.Point.decodeFrom(curve, Buffer.from(partialCombinedNonceHex, 'hex'))
    .add(pubKeyToPoint(nonce));

  if (math.jacobi(R.affineY) !== 1) {
    nonceIsNegated = true;
    R = R.negate();
  }
  return {nonce: R.getEncoded(true).toString('hex'), nonceIsNegated};
};

export const buildMultiPublicKeyHash = (publicKeysHex: string[]): string => { // todo sort
  return crypto.createHash('sha256')
    .update(Buffer.concat(publicKeysHex.map((k) => Buffer.from(k, 'hex'))))
    .digest('hex');
};

export const buildMultiPublicKey = (orderedPublicKeysHex): string => { // todo sort
  const publicKeysHash = buildMultiPublicKeyHash(orderedPublicKeysHex);
  let X = null;
  for (let i = 0; i < orderedPublicKeysHex.length; i++) {
    const XI = pubKeyToPoint(Buffer.from(orderedPublicKeysHex[i], 'hex'));
    const coefficient = computeCoefficient(publicKeysHash, i);
    const summand = XI.multiply(BigInteger.fromHex(coefficient));
    if (X === null) {
      X = summand;
    } else {
      X = X.add(summand);
    }
  }
  return X.getEncoded(true).toString('hex');

};

const computeCoefficient = (publicKeyHashHex: string, index: number): string => {
  const MUSIG_TAG = crypto.createHash('sha256')
    .update(Buffer.from('some text')) // todo why this coef?
    .digest('hex');

  const idxBuf = Buffer.alloc(4);
  idxBuf.writeUInt32LE(index, 0);
  const data = Buffer.concat([
    Buffer.from(MUSIG_TAG, 'hex'),
    Buffer.from(MUSIG_TAG, 'hex'),
    Buffer.from(publicKeyHashHex, 'hex'),
    idxBuf
  ]);

  const hash = crypto.createHash('sha256')
    .update(data)
    .digest('hex');

  return BigInteger.fromHex(hash).mod(curve.n).toString(16).padStart(64, '0');
};

export const partialSign = (
  term: number,
  messageNonce: number,
  privateKeyHex: string,
  publicKeyHex: string,
  index: number,
  nonceCombinedHex: string,
  pubKeyCombinedHex: string,
  pubKeyCombinedHashHex: string,
  nonceIsNegated: boolean): string => {

  const coefficient = computeCoefficient(pubKeyCombinedHashHex, index);
  const secretKey = BigInteger.fromHex(privateKeyHex).multiply(BigInteger.fromHex(coefficient)).mod(curve.n);
  const secretNonce = buildNonce(term, messageNonce, publicKeyHex, pubKeyCombinedHex);

  const R = pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const RX = R.affineX.toBuffer(32);
  const e = math.getE(
    RX,
    pubKeyToPoint(Buffer.from(pubKeyCombinedHex, 'hex')),
    Buffer.from(`${term}:${messageNonce}`.padEnd(32, '0'))
  );

  let k = BigInteger.fromHex(secretNonce);
  if (nonceIsNegated) {
    k = k.negate();
  }
  return secretKey.multiply(e).mod(curve.n).add(k).mod(curve.n).toString(16).padStart(64, '0');
};

export const partialSigVerify = (
  term: number,
  messageNonce: number,
  pubKeyCombinedHex: string,
  pubKeyCombinedHashHex: string,
  partialSigHex: string,
  nonceCombinedHex: string,
  index: number,
  pubKeyHex: string,
  nonceIsNegated: boolean): boolean => {

  const secretNonce = buildNonce(term, messageNonce, pubKeyHex, pubKeyCombinedHex);
  const nonce = curve.G.multiply(BigInteger.fromHex(secretNonce)).getEncoded(true);

  const R = pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const RX = R.affineX.toBuffer(32);
  const e = math.getE(
    RX,
    pubKeyToPoint(Buffer.from(pubKeyCombinedHex, 'hex')),
    Buffer.from(`${term}:${messageNonce}`.padEnd(32, '0'))
  );

  const coefficient = computeCoefficient(pubKeyCombinedHashHex, index);

  const RI = pubKeyToPoint(nonce);
  let RP = math.getR(
    BigInteger.fromHex(partialSigHex),
    e.multiply(BigInteger.fromHex(coefficient)).mod(curve.n),
    pubKeyToPoint(Buffer.from(pubKeyHex, 'hex')));

  if (!nonceIsNegated) {
    RP = RP.negate();
  }
  const sum = RP.add(RI);
  return sum.curve.isInfinity(sum);
};

export const partialSigCombine = (nonceCombinedHex: string, partialSigsHex: string[]): string => {
  const R = pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const RX = R.affineX.toBuffer(32);
  let s = BigInteger.fromHex(partialSigsHex[0]);
  for (let i = 1; i < partialSigsHex.length; i++) {
    s = s.add(BigInteger.fromHex(partialSigsHex[i], 'hex')).mod(curve.n);
  }
  return Buffer.concat([RX, Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]).toString('hex');
};

export const verify = (term: number, messageNonce: number, pubKeyHex: string, signatureHex: string): boolean => {
  const P = pubKeyToPoint(Buffer.from(pubKeyHex, 'hex'));
  const r = BigInteger.fromBuffer(Buffer.from(signatureHex, 'hex').slice(0, 32));
  const s = BigInteger.fromBuffer(Buffer.from(signatureHex, 'hex').slice(32, 64));
  const e = math.getE(r.toBuffer(32), P, Buffer.from(`${term}:${messageNonce}`.padEnd(32, '0')));
  const R = math.getR(s, e, P);

  return !(R.curve.isInfinity(R) || math.jacobi(R.affineY) !== 1 || !R.affineX.equals(r));
};

export const pubKeyToPoint = (pubKey) => {
  const pubKeyEven = (pubKey[0] - 0x02) === 0;
  const x = BigInteger.fromBuffer(pubKey.slice(1, 33));
  return curve.pointFromX(!pubKeyEven, x);
};
