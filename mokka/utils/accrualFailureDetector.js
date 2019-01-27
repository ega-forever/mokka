const _ = require('lodash');

class AccrualFailureDetector {

  constructor () {
    this.intervals = [];
  }


  add (arrivalTime) {
    let interval = this.lastTime ? arrivalTime - this.lastTime : 750;
    this.lastTime = arrivalTime;
    this.intervals.push(interval);
    if (this.intervals.length > 1000)
      this.intervals.shift();

  }

  phi (currentTime) {
    let currentInterval = currentTime - this.lastTime;
    let exp = -1 * currentInterval / _.mean(this.intervals);

    let p = Math.pow(Math.E, exp);
    return -1 * (Math.log(p) / Math.log(10));
  }

}


module.exports = AccrualFailureDetector;
