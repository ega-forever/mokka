const RLP = require('rlp'),
  hashUtils = require('./hashes');


module.exports = (packet) => {

  let decoded = JSON.parse(RLP.decode(packet));

  if (decoded.peer) {
    decoded.publicKey = hashUtils.getHexFromIpfsHash(decoded.peer);
    delete decoded.peer;
  }

  return decoded;

};
