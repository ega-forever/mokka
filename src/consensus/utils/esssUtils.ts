import BN from 'bn.js';
import * as crypto from 'crypto';
import {ec as EC} from 'elliptic';
import {pointToPublicKey, pubKeyToPoint} from './cryptoUtils';

const ec = new EC('secp256k1');

const prime = ec.n;

export const split = (
  candidatePublicKey: string,
  term: number,
  nonce: number,
  needed: number,
  publicKeys: string[]) => {

  const secret = buildSecret(term, nonce, candidatePublicKey);

  const coef = [new BN(secret, 16)];
  const shares = [];
  for (let c = 1; c <= needed; c++) {

    const coefC = crypto.createHash('sha256')
      .update(`${term}:${nonce}:${c}`)
      .digest('hex');

    coef[c] = new BN(coefC, 16);
  }

  for (const publicKey of publicKeys) {
    let y = coef[0];

    const xCoefHex = buildXCoef(term, nonce, publicKey, candidatePublicKey);

    let xCoef = new BN(xCoefHex, 16);
    const xC = new BN(
      pointToPublicKey(
        pubKeyToPoint(Buffer.from(publicKey, 'hex')).mul(xCoef)
      ).toString('hex'), 'hex');

    for (let exp = 1; exp < needed; exp++) {
      const ss = coef[exp].mul(xC.pow(new BN(exp)));
      y = y.add(ss);
    }

    y = y.toString('hex'); // it's bn
    xCoef = xCoef.toString('hex');
    shares.push([xCoef, y]);
  }

  return shares;
};

/*
  Gives the multiplicative inverse of k mod prime.
  In other words (k * modInverse(k)) % prime = 1 for all prime > k >= 1
*/
const modInverse = (k) => {
  k = k.mod(prime);
  const isKNeg = k.lt(new BN(0));
  let r = new BN(prime).egcd(new BN(isKNeg ? k.mul(new BN(-1)) : k)).b;

  if (isKNeg) {
    r = r.mul(new BN(-1));
  }

  return r.add(prime).mod(prime);
};

export const join = (shares: Array<{ x: string, y: string }>): string => {
  let accum = new BN(0);
  for (let k = 0; k < shares.length; k++) {
    /* Multiply the numerator across the top and denominators across the bottom to do Lagrange's interpolation
     * Result is x0(2), x1(4), x2(5) -> -4*-5 and (2-4=-2)(2-5=-3), etc for l0, l1, l2...
     */
    let numerator = new BN(1);
    let denominator = new BN(1);
    for (let i = 0; i < shares.length; i++) {
      if (k === i)
        continue; // If not the same value

      // tslint:disable-next-line:variable-name
      const x_k = new BN(pointToPublicKey(ec.g.mul(shares[k].x)).toString('hex'), 'hex');
      // tslint:disable-next-line:variable-name
      const x_i = new BN(pointToPublicKey(ec.g.mul(shares[i].x)).toString('hex'), 'hex');

      numerator = numerator.mul(x_i).mul(new BN(-1)).mod(prime);
      denominator = denominator.mul(x_k.sub(x_i)).mod(prime);
    }

    accum = accum.add(
      new BN(shares[k].y, 'hex')
        .mul(numerator)
        .mod(prime)
        .add(prime)
        .mod(prime)
        .mul(modInverse(denominator))
        .mod(prime)
        .add(prime)
        .mod(prime)
    )
      .mod(prime)
      .add(prime)
      .mod(prime);

    //   (prime + accum + (shares[k][1] * numerator * modInverse(denominator))) % prime;
  }

  return accum.toString('hex');
};

export const buildMultiSig = (signatures: string[]) => {
  let multiSignature = new BN(0);
  for (const signature of signatures) {
    multiSignature = multiSignature.add(new BN(signature, 16));
  }

  return multiSignature.mod(prime).toString('hex');
};

export const buildXCoef = (
  term: number,
  nonce: number,
  publicKey: string,
  candidatePublicKey: string
): string => {
  return crypto.createHash('sha256')
    .update(`${term}:${nonce}:${publicKey}:${candidatePublicKey}`)
    .digest('hex');
};

export const buildSecret = (term: number, nonce: number, candidatePublicKey: string): string => {
  return crypto.createHash('sha256')
    .update(`${term}:${nonce}:${candidatePublicKey}`)
    .digest('hex');
};

export const validateMultiSig = (
  multisig: string,
  ownerPublicKey,
  publicKeys: string[],
  term: number,
  nonce: number
) => {

  if (!publicKeys.includes(ownerPublicKey)) {
    return false;
  }

  let xCes = null;

  for (const publicKey of publicKeys) {
    const xCoefHex = buildXCoef(term, nonce, publicKey, ownerPublicKey);
    const xC = pubKeyToPoint(Buffer.from(publicKey, 'hex')).mul(new BN(xCoefHex, 16));
    xCes = xCes ? xCes.add(xC) : xC;
  }

  xCes = pointToPublicKey(xCes).toString('hex');

  const sg = pointToPublicKey(ec.g.mul(multisig)).toString('hex');
  return sg === xCes;
};

export const sign = (privateKeyHex: string, xCoef: string) => {
  return new BN(privateKeyHex, 'hex').mul(new BN(xCoef, 'hex')).toString('hex');
};
