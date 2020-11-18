// tslint:disable:variable-name
import BN from 'bn.js';
import * as crypto from 'crypto';
import {ec as EC} from 'elliptic';

const ec = new EC('secp256k1');

/*
In original flow, the R nonce also takes place. The R has been introduced to bring
uniqueness to each session, as "m" may be the same. However, in our flow, "m" should always be different,
as it includes the term and timestamp of current vote session. As a result, the R nonce has been reduced.
 */

/* e = HASH(X || mHash)  */
export const buildE = (sharedPublicKeyX: string, mHash: string): string => {
  return crypto.createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(sharedPublicKeyX, 'hex'),
        Buffer.from(mHash.padEnd(32, '0'))
      ]))
    .digest('hex');
};

/* a1 = HASH(term || X1) */
export const buildCoefficientA = (term: number, publicKeyX: string) => {
  return crypto.createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(term.toString()),
        Buffer.from(publicKeyX, 'hex')
      ]))
    .digest('hex');
};

/* X = X1 * a1 + X2 * a2 + ..Xn * an */
export const buildSharedPublicKeyX = (
  publicKeyXs: string[],
  as: string[]
) => {
  let X = null;
  for (let i = 0; i < publicKeyXs.length; i++) {
    const XI = pubKeyToPoint(Buffer.from(publicKeyXs[i], 'hex')).mul(new BN(as[i], 16));
    X = X === null ? XI : X.add(XI);
  }

  return pointToPublicKey(X).toString('hex');
};

/* let s1 = (R1 + k1 * a1 * e) mod n, where n - is a curve param
* the "n" has been introduced to reduce the signature size
* */
export const buildPartialSignature = (privateKeyK: string, ai: string, e: string): string => {
  return new BN(privateKeyK, 16)
    .mul(new BN(ai, 16))
    .mul(new BN(e, 16))
    .mod(ec.n)
    .toString(16);
};

/* let s1 * G = k1 * a1 * e * G = k1 * a1 * G * e = X1 * a1 * e */
export const partialSignatureVerify = (
  partialSignature: string,
  publicKeyX: string,
  ai: string,
  e: string): boolean => {

  const spG = ec.g.mul(partialSignature);
  const check = pubKeyToPoint(Buffer.from(publicKeyX, 'hex')).mul(e).mul(ai);

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
export const verify = (signature: string, sharedPublicKeyX: string, e: string): boolean => {
  const sg = ec.g.mul(signature);
  const check = pubKeyToPoint(Buffer.from(sharedPublicKeyX, 'hex')).mul(e);
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
