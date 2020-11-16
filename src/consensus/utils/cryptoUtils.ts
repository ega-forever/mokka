// tslint:disable:variable-name
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

function getE(P: string, m: string): string {

  return crypto.createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(P, 'hex'),
        Buffer.from(m.padEnd(32, '0'))
      ]))
    .digest('hex');
}

function getR(s, e, P) {
  const sG = ec.g.mul(s);
  const eP: BN = P.mul(e);
  return sG.add(eP.neg());
}

export const buildK = (
  term: number,
  messageNonce: number,
  publicKeyHex: string,
  pubKeyCombinedHex: string) => {
  const hash = crypto.createHmac('sha256', `${term}:${messageNonce}:${publicKeyHex}`).digest('hex');
  const sessionId = Buffer.from(hash, 'hex');
  const KData = Buffer.concat([
    sessionId,
    Buffer.from(pubKeyCombinedHex, 'hex')
  ]);  // todo message should be replaced with part of SSS
  return crypto.createHash('sha256')
    .update(KData)
    .digest('hex');
};

/*
R is nonce
 */
export const buildCombinedNonce = (
  term: number,
  messageNonce: number,
  publicKeysHex: string[],
  pubKeyCombinedHex: string
): { nonce: string, nonceIsNegated: boolean } => {

  const Ks = publicKeysHex.map((publicKey) => {
    const secretNonce = buildK(term, messageNonce, publicKey, pubKeyCombinedHex);
    const R = ec.g.mul(new BN(secretNonce, 16));
    return pointToPublicKey(R);
  });

  let nonceIsNegated = false;

  let R = pubKeyToPoint(Ks[0]);
  for (let i = 1; i < Ks.length; i++) {
    R = R.add(pubKeyToPoint(Ks[i]));
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
  let X = null;
  for (const publicKeyHex of orderedPublicKeysHex) {
    const XI = pubKeyToPoint(Buffer.from(publicKeyHex, 'hex'));
    X = X === null ? XI : X.add(XI);
  }

  return pointToPublicKey(X).toString('hex');
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

  const secretKey = new BN(privateKeyHex, 16);
  let Ki = new BN(buildK(term, messageNonce, publicKeyHex, pubKeyCombinedHex), 16);
  const e = getE(
    pubKeyCombinedHex,
    `${term}:${messageNonce}`
  );

  if (nonceIsNegated) {
    Ki = new BN(0, 10).sub(Ki);
  }
  return secretKey.mul(new BN(e, 16)).mod(ec.n).add(Ki).mod(ec.n).abs().toString(16).padStart(64, '0');
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

  const K = buildK(term, messageNonce, pubKeyHex, pubKeyCombinedHex);
  const Ri = pointToPublicKey(ec.g.mul(new BN(K, 16)));
  const e = getE(
    pubKeyCombinedHex,
    `${term}:${messageNonce}`
  );

  const RiPoint = pubKeyToPoint(Ri);
  let RPoint = getR(new BN(partialSigHex, 16), e, pubKeyToPoint(Buffer.from(pubKeyHex, 'hex')));

  if (!nonceIsNegated) {
    RPoint = RPoint.neg();
  }
  const sum = RPoint.add(RiPoint);
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

/*  console.log()

  let X = null;
  for (const sigHex of partialSigsHex) {
    const XI = pubKeyToPoint(Buffer.from(sigHex, 'hex'));
    X = X === null ? XI : X.add(XI);
  }

  return pointToPublicKey(X).toString('hex');*/
};

export const verify = (term: number, messageNonce: number, pubKeyHex: string, signatureHex: string): boolean => {
  const P = pubKeyToPoint(Buffer.from(pubKeyHex, 'hex'));
  const r = new BN(Buffer.from(signatureHex, 'hex').slice(0, 32).toString('hex'), 16);
  const s = new BN(Buffer.from(signatureHex, 'hex').slice(32, 64).toString('hex'), 16);
  const e = getE(pubKeyHex, `${term}:${messageNonce}`);
  const R = getR(s, e, P);

  console.log('calc R: ', pointToPublicKey(R).toString('hex'));

  return !(R.isInfinity() || jacobi(R.getY()) !== 1 || !R.getX().eq(r));
};


export const verify2 = (term: number, messageNonce: number, signatureHex: string, pubKeyCombinedHex: string, nonceCombinedHex: string): boolean => {

  const eHex = getE(
    pubKeyCombinedHex,
    `${term}:${messageNonce}`
  );
  const P = pubKeyToPoint(Buffer.from(pubKeyCombinedHex, 'hex'));
  const R = pubKeyToPoint(Buffer.from(nonceCombinedHex, 'hex'));

  const check = pointToPublicKey(P.mul(eHex).add(R));
  const check2 = pointToPublicKey(ec.g.mul(signatureHex));

  console.log('check:', check.toString('hex'));
  console.log('check2:', check2.toString('hex'));

  //R + e * P

  // nonceCombinedHex +

  /*const P = pubKeyToPoint(Buffer.from(pubKeyHex, 'hex'));
  const r = new BN(Buffer.from(signatureHex, 'hex').slice(0, 32).toString('hex'), 16);
  const s = new BN(Buffer.from(signatureHex, 'hex').slice(32, 64).toString('hex'), 16);
  const e = getE(r.toArrayLike(Buffer), P, Buffer.from(`${term}:${messageNonce}`.padEnd(32, '0')));
  const R = getR(s, e, P);

  return !(R.isInfinity() || jacobi(R.getY()) !== 1 || !R.getX().eq(r));*/
  return true;
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
