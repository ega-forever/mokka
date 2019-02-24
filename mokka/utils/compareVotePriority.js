const _ = require('lodash'),
  crypto = require('crypto'),
  speakeasy = require('speakeasy');


const _getIndex = async (currentTerm, mokka, peers, publicKey)=>{

  let minTerm = currentTerm - peers.length > 0 ? currentTerm - peers.length : 1;
  let owners = [];

  if (currentTerm > 1)
    for (let termIndex = minTerm; termIndex < currentTerm; termIndex++) {
      let {index} = await mokka.log.entry.getFirstByTerm(termIndex);

      if (!index)
        continue;

      let entry =  await mokka.log.entry.get(index);
      if(!entry)
        continue;

      owners.push({index: index, owner: entry.owner});
    }

  let currentOwnerPosition = _.chain(owners)
    .sortBy('index')
    .reverse()
    .findIndex((item) => item.owner === publicKey)
    .thru(index => {
      if (!owners.length)
        return null;

      if (index === -1)
        return 6;

      return index;
    })
    .value();

  if (!currentOwnerPosition) {

    let token = speakeasy.hotp({
      secret: mokka.networkSecret,
      counter: currentTerm
    });

    currentOwnerPosition = _.chain(peers)
      .map(pubKey => {

        const hash = crypto.createHmac('sha256', pubKey)
          .update(token)
          .digest('hex');

        return {
          hash: hash,
          key: pubKey
        };

      })
      .sortBy('hash')
      .map(item => item.key)
      .thru(arr => arr.indexOf(publicKey))
      .value();


  }

  return currentOwnerPosition;

};


module.exports = async (currentTerm, mokka, publicKey)=>{

  const peers = _.union([mokka.publicKey], mokka.peers);

  const voteeIndex = await _getIndex(currentTerm, mokka, peers, publicKey);
  const myIndex = await _getIndex(currentTerm, mokka, peers, mokka.publicKey);

  return voteeIndex >= myIndex;


};
