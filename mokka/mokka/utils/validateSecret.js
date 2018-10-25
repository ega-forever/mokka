const _ = require('lodash'),
  speakeasy = require('speakeasy'),
  EthUtil = require('ethereumjs-util'),
  secrets = require('secrets.js-grempe');

module.exports = (networkSecret, window, pubKeys, secret, time, shares) => {

  let token = secrets.hex2str(secret);

  let verified = speakeasy.totp.verify({
    secret: networkSecret,
    token: token,
    step: window / 1000,
    time: time / 1000
  });

  if(!verified)
    return false;

  let notFoundKeys = _.chain(shares)
    .reject(item => {
      if (!_.get(item, 'signed.messageHash'))
        return true;

      const restoredPublicKey = EthUtil.ecrecover(
        Buffer.from(item.signed.messageHash.replace('0x', ''), 'hex'),
        parseInt(item.signed.v),
        Buffer.from(item.signed.r.replace('0x', ''), 'hex'),
        Buffer.from(item.signed.s.replace('0x', ''), 'hex')).toString('hex');
      return pubKeys.includes(restoredPublicKey);
    })
    .size()
    .value();


  let majority = Math.ceil(pubKeys.length / 2) + 1;

  if (pubKeys.length - notFoundKeys < majority)
    return false;


  let validatedShares = _.chain(shares).filter(share => _.has(share, 'signed'))
    .map(share => share.share)
    .value();

  let comb = secrets.combine(validatedShares);

  return comb === secret;
};