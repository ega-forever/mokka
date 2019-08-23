import crypto from 'crypto';

for (let i = 0; i < 3; i++) {
  const node = crypto.createECDH('secp256k1');
  node.generateKeys('hex');
  console.log(`pair[${i + 1}] {publicKey: ${node.getPublicKey('hex', 'compressed')}, secretKey: ${node.getPrivateKey('hex')}`);
}
