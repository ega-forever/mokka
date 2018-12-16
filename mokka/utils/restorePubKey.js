const _ = require('lodash'),
  EthUtil = require('ethereumjs-util'),
  Web3 = require('web3'),
  web3 = new Web3();

module.exports = (message, signature) => {

  if (_.isObject(message))
    message = JSON.stringify(message);

  const messageBuffer = Buffer.from(web3.eth.accounts.hashMessage(message).replace('0x', ''), 'hex');
  const v = _.isObject(signature) ? parseInt(signature.v) : parseInt(signature.substr(signature.length - 2), 16);
  const r = _.isObject(signature) ? Buffer.from(signature.r.replace('0x', ''), 'hex') : Buffer.from(signature.replace('0x', '').substr(0, 64), 'hex');
  const s = _.isObject(signature) ? Buffer.from(signature.s.replace('0x', ''), 'hex') : Buffer.from(signature.replace('0x', '').substr(64, 64), 'hex');

  return EthUtil.ecrecover(messageBuffer, v, r, s).toString('hex');
};