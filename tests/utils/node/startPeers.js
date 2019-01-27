const Wallet = require('ethereumjs-wallet'),
  path = require('path'),
  _ = require('lodash'),
  cp = require('child_process'),
  hashUtils = require('../../../mokka/utils/hashes');


module.exports = async (ports, privKeys, startAtIndexes) => {

  const nodePath = path.join(__dirname, './node.js');
  const nodes = [];

  if (!privKeys)
    privKeys = _.chain(new Array(ports.length)).fill(1).map(() => Wallet.generate().getPrivateKey().toString('hex')).value();

  let pubKeys = privKeys.map(privKey => Wallet.fromPrivateKey(Buffer.from(privKey, 'hex')).getPublicKey().toString('hex'));

  for (let index = 0; index < ports.length; index++) {

    let uris = [];

    for (let index1 = 0; index1 < ports.length; index1++) {
      if (index === index1)
        continue;
      uris.push(`/ip4/127.0.0.1/tcp/${ports[index1]}/ipfs/${hashUtils.getIpfsHashFromHex(pubKeys[index1])}`);
    }

    if (!startAtIndexes || startAtIndexes.includes(index)) {
      const nodePid = cp.fork(nodePath);
      nodes.push(nodePid);

      nodePid.send({
        command: 'start',
        options: {
          electionMax: 1000,
          electionMin: 300,
          delay: 100,
          heartbeat: 100,
          port: ports[index],
          peers: uris,
          logLevel: 30,
          privateKey: privKeys[index]
        }
      });
    }
  }

  return {nodes, privKeys};

};