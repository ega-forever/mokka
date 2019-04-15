class StateModel {

    public index: number;
    public hash: string;
    public term: number;
    public createdAt: number;
    public committedIndex: number;

    constructor({index = 0, hash = ''.padStart(32, '0'), term = 0, createdAt = Date.now(), committedIndex = 0}) {
        this.index = index;
        this.hash = hash;
        this.term = term;
        this.createdAt = createdAt;
        this.committedIndex = committedIndex;

    }
}

export {StateModel};
