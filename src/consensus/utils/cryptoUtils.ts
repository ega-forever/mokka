import BN from 'bn.js';
import * as crypto from 'crypto';
import {ec as EC} from 'elliptic';

const ec = new EC('secp256k1');

function jacobi(num: BN): number {
  return parseInt(num.toRed(BN.mont(ec.curve.p)).redPow(
    ec.curve.p.sub(new BN(1, 10))
      .div(new BN(2, 10))
  ).fromRed()
    .toString(10)
    .slice(0, 3), 10);
}

function getE(RX: Buffer, P, m: Buffer): BN {

  const hash = crypto.createHash('sha256')
    .update(
      Buffer.concat([
        RX,
        pointToPublicKey(P),
        m
      ]))
    .digest('hex');

  return new BN(hash, 16).mod(ec.curve.n); // todo can be slow, as not red
}

function getR(s, e, P) {
  const sG = ec.g.mul(s);
  const eP: BN = P.mul(e);
  return sG.add(eP.neg());
}

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
  pubKeyCombinedHex: string
): { nonce: string, nonceIsNegated: boolean } => {

  const nonces = publicKeysHex.map((publicKey) => {
    const secretNonce = buildNonce(term, messageNonce, publicKey, pubKeyCombinedHex);
    const R = ec.g.mul(new BN(secretNonce, 16));
    return pointToPublicKey(R);
  });

  let nonceIsNegated = false;

  let R = pubKeyToPoint(nonces[0]);
  for (let i = 1; i < nonces.length; i++) {
    R = R.add(pubKeyToPoint(nonces[i]));
  }

  if (jacobi(R.getY()) !== 1) {
    nonceIsNegated = true;
    R = R.neg();
  }

  return {nonce: pointToPublicKey(R).toString('hex'), nonceIsNegated};
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
    const summand = XI.mul(new BN(coefficient, 16));
    if (X === null) {
      X = summand;
    } else {
      X = X.add(summand);
    }
  }

  return pointToPublicKey(X).toString('hex');
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

  //  return BigInteger.fromHex(hash).mod(curve.n).toString(16).padStart(64, '0');
  return new BN(hash, 16).mod(ec.n).toString(16).padStart(64, '0');
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
  const secretKey = new BN(privateKeyHex, 16).mul(new BN(coefficient, 16)).mod(ec.n);
  const secretNonce = buildNonce(term, messageNonce, publicKeyHex, pubKeyCombinedHex);

  const R = pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));

  const RX = R.getX().toArrayLike(Buffer);
  const e = getE(
    RX,
    pubKeyToPoint(Buffer.from(pubKeyCombinedHex, 'hex')),
    Buffer.from(`${term}:${messageNonce}`.padEnd(32, '0'))
  );

  let k = new BN(secretNonce, 16);
  if (nonceIsNegated) {
    k = new BN(0, 10).sub(k);
  }
  return secretKey.mul(e).mod(ec.n).add(k).mod(ec.n).abs().toString(16).padStart(64, '0');
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
  const nonce = pointToPublicKey(ec.g.mul(new BN(secretNonce, 16)));

  const R = pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const RX = R.getX().toArrayLike(Buffer);

  const e = getE(
    RX,
    pubKeyToPoint(Buffer.from(pubKeyCombinedHex, 'hex')),
    Buffer.from(`${term}:${messageNonce}`.padEnd(32, '0'))
  );

  const coefficient = computeCoefficient(pubKeyCombinedHashHex, index);
  const RI = pubKeyToPoint(nonce);

  let RP = getR(
    new BN(partialSigHex, 16),
    e.mul(new BN(coefficient, 16)).mod(ec.n),
    pubKeyToPoint(Buffer.from(pubKeyHex, 'hex')));

  if (!nonceIsNegated) {
    RP = RP.neg();
  }
  const sum = RP.add(RI);
  return sum.isInfinity();
};

export const partialSigCombine = (nonceCombinedHex: string, partialSigsHex: string[]): string => {
  const R = pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));
  const RX = R.getX().toArrayLike(Buffer);
  let s = new BN(partialSigsHex[0], 16);
  for (let i = 1; i < partialSigsHex.length; i++) {
    s = s.add(new BN(partialSigsHex[i], 16)).mod(ec.n);
  }
  return Buffer.concat([RX, Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]).toString('hex');
};

export const verify = (term: number, messageNonce: number, pubKeyHex: string, signatureHex: string): boolean => {
  const P = pubKeyToPoint(Buffer.from(pubKeyHex, 'hex'));
  const r = new BN(Buffer.from(signatureHex, 'hex').slice(0, 32).toString('hex'), 16);
  const s = new BN(Buffer.from(signatureHex, 'hex').slice(32, 64).toString('hex'), 16);
  const e = getE(r.toArrayLike(Buffer), P, Buffer.from(`${term}:${messageNonce}`.padEnd(32, '0')));
  const R = getR(s, e, P);

  return !(R.isInfinity() || jacobi(R.getY()) !== 1 || !R.getX().eq(r));
};

export const pubKeyToPoint = (pubKey) => {
  const pubKeyEven = (pubKey[0] - 0x02) === 0;
  return ec.curve.pointFromX(pubKey.slice(1, 33).toString('hex'), !pubKeyEven);
};

const pointToPublicKey = (P): Buffer => {
  const buffer = Buffer.allocUnsafe(1);
  // keep sign, if is odd
  buffer.writeUInt8(P.getY().isEven() ? 0x02 : 0x03, 0);
  return Buffer.concat([buffer, P.getX().toArrayLike(Buffer)]);
};
