const StateModel = require('../../node/models/stateModel'); //todo move to log


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


  async getAll (index, applier) {


    let entries = await this.log.entry.getUncommittedUpToIndex(index);


  let state = await new Promise((resolve, reject) => {

      const stateModel = new StateModel({});

      this.log.db.createReadStream({
        reverse: true,
        limit: 1,
        lt: `${this.log.prefixes.triggers + 1}:`,
        gt: `${this.log.prefixes.triggers}:`
      })
        .on('data', (data) => {
          let key = data.key.toString().replace(`${this.log.prefixes.triggers}:`, '');
          stateModel.put(key, data.value);
        })
        .on('error', (err) => {
          reject(err);
        })
        .on('end', () => {
            resolve(stateModel);
        });
    });


  if(!entries.length)
    return state.state;

  for(let entry of entries)
    await applier(entry.command, state);

    return state.state;

  }




}


module.exports = StateMethods;
