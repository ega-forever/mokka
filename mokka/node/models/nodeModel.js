const EventEmitter = require('events'),
  Wallet = require('ethereumjs-wallet'),
  Multiaddr = require('multiaddr'),
  states = require('../factories/stateFactory'),
  hashUtils = require('../../utils/hashes');

class NodeModel extends EventEmitter {

  constructor (options = {}) {
    super();

    this.privateKey = options.privateKey;
    this.publicKey = options.privateKey ? Wallet.fromPrivateKey(Buffer.from(options.privateKey, 'hex')).getPublicKey().toString('hex') : options.publicKey;
    this.peers = options.peers;

    this.state = options.state || states.FOLLOWER;
    this.leader = '';
    this.term = 0;
    this.nodes = [];

    try {
      const multiaddr = Multiaddr(options.address);
      const mOptions = multiaddr.toOptions();
      this.address = `${mOptions.transport}://${mOptions.host}:${mOptions.port}`;
      this.id = multiaddr.getPeerId();
      this.publicKey = hashUtils.getHexFromIpfsHash(multiaddr.getPeerId());
    } catch (e) {
      this.address = options.address;
      this.id = hashUtils.getIpfsHashFromHex(this.publicKey);
    }


  }
}


module.exports = NodeModel;