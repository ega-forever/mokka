const encode = require('encoding-down'),
  _ = require('lodash'),
  levelup = require('levelup'),
  pendingMethods = require('./methods/pendingMethods'),
  commandMethods = require('./methods/commandMethods'),
  proofMethods = require('./methods/proofMethods'),
  entryMethods = require('./methods/entryMethods'),
  EventEmitter = require('events');

class Log extends EventEmitter {

  constructor (node, options = {}) {
    super();

    let _options = _.cloneDeep(options);

    if (!_options.adapter)
      _options.adapter = require('memdown');

    this.prefixes = {
      logs: 1,
      term: 2,
      pending: 3,
      refs: 4,
      pendingRefs: 5,
      pendingStates: 6,
      states: 7
    };

    this.eventTypes = {
      LOGS_UPDATED: 'logs_updated'
    };

    this.node = node;

    this.pending = new pendingMethods(this);
    this.entry = new entryMethods(this);
    this.proof = new proofMethods(this);
    this.command = new commandMethods(this);

    this.db = levelup(encode(_options.adapter(`${options.path}_db`), {valueEncoding: 'json', keyEncoding: 'binary'}));
  }



  /**
   * end - Log end
   * Called when the node is shutting down
   *
   * @return {boolean} Successful close.
   * @private
   */
  end () {
    return this.db.close();
  }
}


module.exports = Log;
