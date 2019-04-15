class TriggerStateModel {

    public index: number;
    public hash: string;
    public term: number;

    constructor({index = 0, hash = ''.padStart(32, '0'), term = 0}) {
        this.index = index;
        this.hash = hash;
        this.term = term;

    }
}

export {TriggerStateModel};
