const nacl = require('tweetnacl');


for (let i = 0; i < 3; i++) {
  const key = nacl.sign.keyPair();
  console.log(`pair[${i + 1}] {publicKey: ${Buffer.from(key.publicKey).toString('hex')}, secretKey: ${Buffer.from(key.secretKey).toString('hex')}`)
}