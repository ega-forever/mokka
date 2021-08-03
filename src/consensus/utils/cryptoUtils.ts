// tslint:disable:variable-name
import BN from 'bn.js';
import * as crypto from 'crypto';
import {ec as EC} from 'elliptic';

const ec = new EC('secp256k1');

export const buildPublicKeysRoot = (
  publicKeys: string[]
) => {

  let X = null;
  for (let i = 0; i < publicKeys.length; i++) {
    const XI = pubKeyToPoint(Buffer.from(publicKeys[i], 'hex'));
    X = X === null ? XI : X.add(XI);
  }

  return pointToPublicKey(X).toString('hex');
};


export const buildPublicKeysRootForTerm = (
  publicKeysRoot: string,
  term: number,
  nonce: number|string,
  candidatePublicKey: string
) => {

  const mHash = crypto.createHash('sha256')
    .update(`${nonce}:${term}:${candidatePublicKey}`)
    .digest('hex');

  let X = pubKeyToPoint(Buffer.from(publicKeysRoot, 'hex')).mul(new BN(mHash, 16));
  return pointToPublicKey(X).toString('hex');
};


/* X = X1 * a1 + X2 * a2 + ..Xn * an */
export const buildSharedPublicKeyX = (
  publicKeys: string[],
  term: number,
  nonce: number|string,
  publicKeysRootForTerm: string
) => {

  const mHash = crypto.createHash('sha256')
    .update(`${nonce}:${term}:${publicKeysRootForTerm}`)
    .digest('hex');

  let X = null;
  for (let i = 0; i < publicKeys.length; i++) {
    const XI = pubKeyToPoint(Buffer.from(publicKeys[i], 'hex')).mul(new BN(mHash, 16));
    X = X === null ? XI : X.add(XI);
  }

  return pointToPublicKey(X).toString('hex');
};


/* let s1 = (R1 + k1 * a1 * e) mod n, where n - is a curve param
* the "n" has been introduced to reduce the signature size
* */
export const buildPartialSignature = (privateKeyK: string, term: number, nonce: number, sharedPublicKeyFull: string): string => {
  const mHash = crypto.createHash('sha256')
    .update(`${nonce}:${term}:${sharedPublicKeyFull}`)
    .digest('hex');

  return new BN(privateKeyK, 16)
    .mul(new BN(mHash, 16))
    .mod(ec.n)
    .toString(16);
};

/* let s1 * G = k1 * a1 * e * G = k1 * a1 * G * e = X1 * a1 * e */
export const partialSignatureVerify = (
  partialSignature: string,
  publicKey: string,
  nonce: number,
  term: number,
  sharedPublicKeyX: string): boolean => {

  const mHash = crypto.createHash('sha256')
    .update(`${nonce}:${term}:${sharedPublicKeyX}`)
    .digest('hex');

  const spG = ec.g.mul(partialSignature);
  const check = pubKeyToPoint(Buffer.from(publicKey, 'hex')).mul(mHash);
  return pointToPublicKey(spG).toString('hex') === pointToPublicKey(check).toString('hex');
};

/* s = s1 + s2 + ...sn */
export const buildSharedSignature = (partialSignatures: string[]): string => {
  let signature = new BN(0);

  for (const sig of partialSignatures) {
    signature = signature.add(new BN(sig, 16));
  }

  return signature.toString(16);
};

/* sG = X * e */
export const verify = (
  signature: string,
  sharedPublicKeyX: string): boolean => {

  const sg = ec.g.mul(signature);
  const check = pubKeyToPoint(Buffer.from(sharedPublicKeyX, 'hex'));
  return pointToPublicKey(sg).toString('hex') === pointToPublicKey(check).toString('hex');
};

export const pubKeyToPoint = (pubKey) => {
  const pubKeyEven = (pubKey[0] - 0x02) === 0;
  return ec.curve.pointFromX(pubKey.slice(1, 33).toString('hex'), !pubKeyEven);
};

export const pointToPublicKey = (P): Buffer => {
  const buffer = Buffer.allocUnsafe(1);
  // keep sign, if is odd
  buffer.writeUInt8(P.getY().isEven() ? 0x02 : 0x03, 0);
  return Buffer.concat([buffer, P.getX().toArrayLike(Buffer)]);
};
