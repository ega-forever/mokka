class EntryModel {

    public index: number;
    public hash: string;
    public term: number;
    public createdAt: number;
    public responses: string[];
    public signature: string;
    public log: any;

    constructor({
                    index = 0,
                    hash = ''.padStart(32, '0'),
                    term = 0,
                    committed = true,
                    createdAt = Date.now(),
                    // @ts-ignore
                    responses = [],
                    signature = '',
                    log = ''
                }) {
        this.index = index;
        this.hash = hash;
        this.term = term;
        this.createdAt = createdAt;
        this.responses = responses;
        this.signature = signature;
        this.log = log;
    }
}

export {EntryModel};
