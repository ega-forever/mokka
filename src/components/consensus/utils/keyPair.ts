import bigInt from 'big-integer';
import crypto, {ECDH} from 'crypto';

// @ts-ignore
const prime = new bigInt('fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f', 16);
const pIdent = prime.add(1).divide(4);

export function convertKeyPairToRawSecp256k1(keyPair: ECDH) {

// Print the PEM-encoded private key
  const privateKey = `-----BEGIN PRIVATE KEY-----
${Buffer.from(`308184020100301006072a8648ce3d020106052b8104000a046d306b0201010420${keyPair.getPrivateKey('hex')}a144034200${keyPair.getPublicKey('hex')}`, 'hex').toString('base64')}
-----END PRIVATE KEY-----`;

// Print the PEM-encoded public key
  const publicKey = `-----BEGIN PUBLIC KEY-----
${Buffer.from(`3056301006072a8648ce3d020106052b8104000a034200${keyPair.getPublicKey('hex')}`, 'hex').toString('base64')}
-----END PUBLIC KEY-----`;

  return {
    privateKey,
    publicKey
  };

}

export function convertPublicKeyToRawSecp256k1(publicKey: string) {

  if (publicKey.length !== 130) {
    publicKey = decompressPublicKeySecp256k1(publicKey);
  }

  return `-----BEGIN PUBLIC KEY-----
${Buffer.from(`3056301006072a8648ce3d020106052b8104000a034200${publicKey}`, 'hex').toString('base64')}
-----END PUBLIC KEY-----`;
}

export function decompressPublicKeySecp256k1(compressedPublicKey: string) {

  const signY = parseInt(compressedPublicKey[1], 10) - 2;
  // @ts-ignore
  const x = new bigInt(compressedPublicKey.substring(2), 16);
  // y mod p = +-(x^3 + 7)^((p+1)/4) mod p
  let y = x.modPow(3, prime).add(7).mod(prime).modPow(pIdent, prime);
  // If the parity doesn't match it's the *other* root
  if (y.mod(2).toJSNumber() !== signY) {
    // y = prime - y
    y = prime.subtract(y);
  }
  return '04' + x.toString(16).padStart(64, '0') + y.toString(16).padStart(64, '0');
}

export function compressPublicKeySecp256k1(publicKey: string) {
  return publicKey.slice(0, 66);
}
