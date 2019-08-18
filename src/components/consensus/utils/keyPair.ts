import {ECDH} from 'crypto';

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
  return `-----BEGIN PUBLIC KEY-----
${Buffer.from(`3056301006072a8648ce3d020106052b8104000a034200${publicKey}`, 'hex').toString('base64')}
-----END PUBLIC KEY-----`;
}
