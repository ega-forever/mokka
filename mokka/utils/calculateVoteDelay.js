const _ = require('lodash'),
  crypto = require('crypto'),
  speakeasy = require('speakeasy');

module.exports = async (currentTerm, publicKey, mokka)=>{

  const peers = _.union([mokka.publicKey], mokka.peers);

  let minTerm = currentTerm - peers.length > 0 ? currentTerm - peers.length : 1;
  let owners = [];

  if (currentTerm > 1)
    for (let termIndex = minTerm; termIndex < currentTerm; termIndex++) {
      let {index} = await mokka.log.getFirstEntryByTerm(termIndex);

      if (!index)
        continue;

      let entry =  await mokka.log.get(index);
      if(!entry)
        continue;

      if (entry.owner === mokka.publicKey)
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
        }

      })
      .sortBy('hash')
      .map(item => item.key)
      .thru(arr => arr.indexOf(publicKey))
      .value();


  }

  return (currentOwnerPosition + 1) * mokka.election.max;

};