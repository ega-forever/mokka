const bs58 = require('bs58');

const getHexFromIpfsHash = (ipfsListing) => {
  return bs58.decode(ipfsListing).slice(2).toString('hex');
};

const getIpfsHashFromHex = (hash) => {
  const hashHex = '1220' + hash.replace('0x', '');
  const hashBytes = Buffer.from(hashHex, 'hex');
  return bs58.encode(hashBytes);
};

const isBase58 = (hash)=>{

  try {
    bs58.decode(hash);
    return true;
  }catch (e) {
    return false;
  }

};

module.exports = {
  getHexFromIpfsHash,
  getIpfsHashFromHex,
  isBase58
};