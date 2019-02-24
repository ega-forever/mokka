const getBnNumber = require('../../utils/getBnNumber');

class ProofMethods {

  constructor (log){
    this.log = log;
  }


  async add (term, proof) { //do we need to
    return await this.log.db.put(`${this.log.prefixes.term}:${getBnNumber(term)}`, proof);
  }

  async get (term) {
    try {
      return await this.log.db.get(`${this.log.prefixes.term}:${getBnNumber(term)}`);
    } catch (e) {
      return null;
    }

  }

}

module.exports = ProofMethods;
