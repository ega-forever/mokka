export class StateModel {

  public index: number;
  public hash: string;
  public term: number;
  public createdAt: number;

  constructor(
    index: number = 0,
    hash: string = ''.padStart(32, '0'),
    term: number = 0,
    createdAt: number = Date.now()) {
    this.index = index;
    this.hash = hash;
    this.term = term;
    this.createdAt = createdAt;

  }
}
