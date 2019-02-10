class StateModel { //todo inherit interface from log/methods

  constructor (state) {
    this.state = state;
  }

  put (key, value) {
    this.state[key] = value;
  }

  get (key) {
    return this.state[key];
  }

  del (key) {
    delete this.state[key];
  }

}

module.exports = StateModel;
