const RLP = require('rlp'),
  hashUtils = require('./hashes'),
  _ = require('lodash');


module.exports = (packet)=>{

  const _packet = _.cloneDeep(packet);

  if(_packet.publicKey){
    _packet.peer =  hashUtils.getIpfsHashFromHex(packet.publicKey);
    delete _packet.publicKey;
  }

  return RLP.encode(JSON.stringify(_packet));
};
