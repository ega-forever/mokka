const _ = require('lodash'),
  bunyan = require('bunyan'),
  crypto = require('crypto'),
  log = bunyan.createLogger({name: 'node.utils.calculateVoteDelay'}),
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

      let {owner} = await mokka.log.get(index);
      if (owner === mokka.publicKey)
        continue;

      owners.push({index, owner});
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

  log.info('candidate index: ', currentOwnerPosition);

  if (!currentOwnerPosition) {

    let token = speakeasy.hotp({
      secret: mokka.networkSecret,
      counter: currentTerm
    });

    log.info(`super token: ${token} for term: ${currentTerm}`);

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

  console.log(`current pos: ${currentOwnerPosition}`)
  return (currentOwnerPosition + 1) * mokka.election.max;

};