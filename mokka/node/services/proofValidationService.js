const speakeasy = require('speakeasy'),
  _ = require('lodash'),
  restorePubKey = require('../../utils/restorePubKey'),
  secrets = require('secrets.js-grempe');

class ProofValidation {

  constructor (mokka) {
    this.mokka = mokka;
  }


  async validate (term, proof, entry) {

    let savedProof = await this.mokka.log.getProof(term);

    if (savedProof && savedProof.proof === proof && !entry)
      return true;

    if(savedProof && savedProof.proof !== proof){
      this.mokka.logger.trace(`going to rewrite proof for term ${term}`);
      let entry = await this.mokka.log.getFirstEntryByTerm(term);
      this.mokka.logger.trace(`first entry by term ${JSON.stringify(entry)}`);
    }

    let extracted = ProofValidation._extract(proof);

    if (entry && entry.index > 0) {

      const item = _.chain(extracted.items).sortBy('secret').last().value();
      const restoredPublicKey = restorePubKey(item.secret, _.pick(item, ['r', 's', 'v']));

      if (entry.owner !== restoredPublicKey) {
        const owner = restorePubKey(entry.command, entry.signature);

        this.mokka.logger.trace(item);
        this.mokka.logger.trace(`wrong proof sig entry owner - ${entry.owner}, restored from share - ${restoredPublicKey}, restored from record ${owner}`);
        return false;
      }
    }

    if (savedProof && savedProof.proof === proof)
      return true;


    let pubKeys = this.mokka.nodes.map(node => node.publicKey);
    pubKeys.push(this.mokka.publicKey);

    let items = _.filter(extracted.items, item => {

      const restoredPublicKey = restorePubKey(item.secret, _.pick(item, ['r', 's', 'v']));
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

    if (!verified) {
      this.mokka.logger.trace('wrong time token provided!');
      return false;
    }

    this.mokka.logger.trace(`saving proof at term ${term}`);

    await this.mokka.log.addProof(term, {
      proof: proof,
      index: -1,
      hash: null
    });

    return true;
  }


  static _extract (proof) {

    let items = [];

    const splitProof = proof.split('x');
    const itemsAmount = splitProof[0];
    proof = splitProof[1];

    const time = proof.substr(proof.length - 13, proof.length);
    proof = proof.substr(0, proof.length - 13);
    const offset = proof.length / itemsAmount;
    const secretSize = offset - 130;

    for (let index = 0; index < proof.length; index += offset) {
      let item = proof.substr(index, index + offset);

      let secret = item.substr(0, secretSize);
      let r = `0x${item.substr(secretSize, 64)}`;
      let s = `0x${item.substr(secretSize + 64, 64)}`;
      let v = `0x${item.substr(secretSize + 128, 2)}`;

      items.push({secret, r, s, v});
    }

    return {time, items};

  }

}


module.exports = ProofValidation;
