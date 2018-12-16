const speakeasy = require('speakeasy'),
  EthUtil = require('ethereumjs-util'),
  Web3 = require('web3'),
  web3 = new Web3(),
  _ = require('lodash'),
  bunyan = require('bunyan'),
  log = bunyan.createLogger({name: 'node.services.proofValidation'}),
  secrets = require('secrets.js-grempe');

class ProofValidation {

  constructor (mokka) {
    this.mokka = mokka;
  }


  async validate (term, proof) {

    let savedProof = await this.mokka.log.getProof(term);

    if (savedProof && savedProof.proof === proof)
      return true;


    let extracted = ProofValidation._extract(proof);

    let pubKeys = this.mokka.nodes.map(node => node.publicKey);
    pubKeys.push(this.mokka.publicKey);

    let items = _.filter(extracted.items, item=>{

      const restoredPublicKey = EthUtil.ecrecover(
        Buffer.from(web3.eth.accounts.hashMessage(item.secret).replace('0x', ''), 'hex'),
        parseInt(item.v),
        Buffer.from(item.r.replace('0x', ''), 'hex'),
        Buffer.from(item.s.replace('0x', ''), 'hex')).toString('hex');
      return pubKeys.includes(restoredPublicKey);

    });

    let comb = secrets.combine(items.map(item => item.secret));
    comb = secrets.hex2str(comb);

    let verified = speakeasy.totp.verify({
      secret: this.mokka.networkSecret,
      token: comb,
      //step: window / 1000,
      step: 30,
      time: parseInt(extracted.time / 1000),
      window: 2
    });

    if (!verified)
      return false;

    log.info(`saving proof at term ${term}`);

    await this.mokka.log.addProof(term, {
      proof: proof,
      index: -1,
      hash: null
    });

    return true;
  }


  static _extract (proof) {

    let items = [];

    let offset = 35 + 64 + 64 + 2;

    let time = proof.substr(proof.length - 13, proof.length);
    proof = proof.substr(0, proof.length - 13);

    for (let index = 0; index < proof.length; index += offset) {
      let item = proof.substr(index, index + offset);

      let secret = item.substr(0, 35);
      let r = `0x${item.substr(35, 64)}`;
      let s = `0x${item.substr(99, 64)}`;
      let v = `0x${item.substr(163, 2)}`;

      items.push({secret, r, s, v});
    }

    return {time, items};

  }

}


module.exports = ProofValidation;