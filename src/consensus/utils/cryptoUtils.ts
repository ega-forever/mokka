// tslint:disable:variable-name
import BN from 'bn.js';
import crypto from 'crypto';
import {ec as EC} from 'elliptic';

const ec = new EC('secp256k1');

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

export const buildMultiPublicKey = (
  publicKeys: string[]
): string => {
  let X = null;
  for (const publicKey of publicKeys) {
    const XI = pubKeyToPoint(Buffer.from(publicKey, 'hex'));
    X = X === null ? XI : X.add(XI);
  }

  return pointToPublicKey(X).toString('hex');
};

export const buildSecret = (term: number, required: number, nonce: number, candidatePublicKey: string) => {
  return crypto.createHash('sha256')
    .update(`${term}${required}${nonce}${candidatePublicKey}`)
    .digest('hex');
};

export const sign = (privateKey: string, secret: string) => {
  return new BN(privateKey, 'hex').mul(new BN(secret, 'hex')).mod(ec.n);
};

export const buildMultiSignature = (
  signatures: string[]
): string => {
  let S = new BN('0');
  for (const signature of signatures) {
    S = S.add(new BN(signature, 16)).mod(ec.n);
  }

  return S.toString(16);
};

export const partialValidateMultiSig = (secret: string, publicKey: string, signature: string) => {
  const sg = pointToPublicKey(ec.g.mul(signature)).toString('hex');
  const pubs = pointToPublicKey(pubKeyToPoint(Buffer.from(publicKey, 'hex')).mul(new BN(secret, 16))).toString('hex');

  return sg === pubs;
};

export const validateMultiSig = (
  multisignature: string,
  secret: string,
  publicKeys: string[],
  notInvolvedPublicKeys: string[]
): boolean => {

  const sg = pointToPublicKey(ec.g.mul(multisignature)).toString('hex');

  let allPublicKeysMulSecret = null;

  for (const publicKey of publicKeys) {
    const xC = pubKeyToPoint(Buffer.from(publicKey, 'hex')).mul(new BN(secret, 16));
    allPublicKeysMulSecret = allPublicKeysMulSecret ? allPublicKeysMulSecret.add(xC) : xC;
  }

  allPublicKeysMulSecret = pointToPublicKey(allPublicKeysMulSecret).toString('hex');

  let sgPlusNotInvolvedPublicKeys = pubKeyToPoint(Buffer.from(sg, 'hex'));

  for (const publicKey of notInvolvedPublicKeys) {
    const dPub = pubKeyToPoint(Buffer.from(publicKey, 'hex')).mul(new BN(secret, 16));
    sgPlusNotInvolvedPublicKeys = sgPlusNotInvolvedPublicKeys.add(dPub);
  }

  sgPlusNotInvolvedPublicKeys = pointToPublicKey(sgPlusNotInvolvedPublicKeys).toString('hex');

  return sgPlusNotInvolvedPublicKeys === allPublicKeysMulSecret;
};
