module.exports = (options, mokka) => {
  options = options || {};

  let node = {
    Log: mokka.Log,
    electionMax: mokka.election.max,
    electionMin: mokka.election.min,
    heartbeat: mokka.beat,
    threshold: mokka.threshold
  };

  for (let key in node) {
    if (key in options || !node.hasOwnProperty(key))
      continue;

    options[key] = node[key];
  }

  return new mokka.constructor(options);
};