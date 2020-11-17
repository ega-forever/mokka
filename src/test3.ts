import BN from 'bn.js';
import crypto from 'crypto';
import {ec as EC} from 'elliptic';
import Signature from 'elliptic/lib/elliptic/ec/signature';
import * as utils from './consensus/utils/cryptoUtils';
import {pointToPublicKey, pubKeyToPoint} from './consensus/utils/cryptoUtils';

const ec = new EC('secp256k1');

const keys = [];

for (let i = 0; i < 3; i++) {
  const node = crypto.createECDH('secp256k1');
  node.generateKeys();

  const node1 = crypto.createECDH('secp256k1');
  node1.generateKeys();

  if (node.getPrivateKey().toString('hex').length !== 64 || node1.getPrivateKey().toString('hex').length !== 64) {
    i--;
    continue;
  }

  keys.push({
    k: node.getPrivateKey().toString('hex'),
    X: node.getPublicKey('hex', 'compressed'),
    r: node1.getPrivateKey().toString('hex'),
    R: node1.getPublicKey('hex', 'compressed')
  });

}

const nonce = Date.now();
const term = 3;

const l = nonce;

// ai = H(l || p)

const ai = [];
for (const key of keys) {
  const a = crypto.createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(nonce.toString()),
        Buffer.from(key.X, 'hex')
      ]))
    .digest('hex');
  ai.push(a);
}

console.log('ai[0], ', ai[0]);
console.log('ai[0], ', keys[0].X);

// X = sum( a_i X_i)
let X = null;
for (let i = 0; i < keys.length; i++) {
  const XI = pubKeyToPoint(Buffer.from(keys[i].X, 'hex')).mul(new BN(ai[i], 16));
  X = X === null ? XI : X.add(XI);
}

X = pointToPublicKey(X).toString('hex');

const m = crypto.createHash('sha256')
  .update(`${nonce}:${term}`)
  .digest('hex');

// Calc shared nonce

let R = null;
for (const key of keys) {
  const RI = pubKeyToPoint(Buffer.from(key.R, 'hex'));
  R = R === null ? RI : R.add(RI);
}

R = pointToPublicKey(R).toString('hex');

const e = crypto.createHash('sha256')
  .update(
    Buffer.concat([
      Buffer.from(R, 'hex'),
      Buffer.from(X, 'hex'),
      Buffer.from(m.padEnd(32, '0'))
    ]))
  .digest('hex');

const partialSignatures = [];

// let s1 = r1 + k1 * a1 * e;
for (let i = 0; i < keys.length; i++) {
  let s = new BN(keys[i].k, 16)
    .mul(new BN(ai[i], 16))
    .mul(new BN(e, 16))
    .add(new BN(keys[i].r, 16));

  s = s.mod(ec.n).toString(16);

  partialSignatures.push(s);
}

let signature = new BN(0);

for (const sig of partialSignatures) {
  signature = signature.add(new BN(sig, 16));
}

// console.log(signature.toString('hex').length);
const sg = ec.g.mul(signature);
console.log(pointToPublicKey(sg).toString('hex'));

const RP = pubKeyToPoint(Buffer.from(R, 'hex'));
const XPe = pubKeyToPoint(Buffer.from(X, 'hex')).mul(e);
const check2 = RP.add(XPe);
console.log(pointToPublicKey(check2).toString('hex'));

/*console.log(X.length)
const Xpoint = pubKeyToPoint(X);

console.log(ePoint.mul(Xpoint));*/
