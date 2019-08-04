class AccrualFailureDetector {

  private intervals: number[] = [];
  private lastTime: number;

  public add(arrivalTime: number) {
    const interval = this.lastTime ? arrivalTime - this.lastTime : 750;
    this.lastTime = arrivalTime;
    this.intervals.push(interval);
    if (this.intervals.length > 1000)
      this.intervals.shift();

  }

  public phi(currentTime: number) {
    const currentInterval = currentTime - this.lastTime;
    const mean = this.intervals.reduce((a, b) => a + b) / this.intervals.length;
    const exp = -1 * currentInterval / mean;

    const p = Math.pow(Math.E, exp);
    return -1 * (Math.log(p) / Math.log(10));
  }

}

export {AccrualFailureDetector};
