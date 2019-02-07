class StateMethods {

  constructor (log) {
    this.log = log;
  }


  async get(key){
    try {
      return await this.log.db.get(`${this.log.prefixes.triggers}:${key}`);
    } catch (err) {
      return null;
    }
  }

  async put (key, value){
    return await this.log.db.put(`${this.log.prefixes.triggers}:${key}`, value);
  }

  async del (key){
    return await this.log.db.del(`${this.log.prefixes.triggers}:${key}`);
  }


  getAll () {
    const state = {};

    return new Promise((resolve, reject) => {

      this.log.db.createReadStream({
        reverse: true,
        limit: 1,
        lt: `${this.log.prefixes.triggers + 1}:`,
        gt: `${this.log.prefixes.triggers}:`
      })
        .on('data', (data) => {
          let key = data.key.toString().replace(`${this.log.prefixes.triggers}:`, '');
          state[key] = data.value;
        })
        .on('error', (err) => {
          reject(err);
        })
        .on('end', () => {
            resolve(state);
        });
    });
  }

}


module.exports = StateMethods;
