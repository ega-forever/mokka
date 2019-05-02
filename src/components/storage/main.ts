import {EntryApi} from './api/EntryApi';
import {LogApi} from './api/LogApi';
import {StateApi} from './api/StateApi';
import {IStorageInterface} from './interfaces/IStorageInterface';

class MokkaStorage {
    private adapter: IStorageInterface;
    private entry: EntryApi;
    private state: StateApi;
    private log: LogApi;

    constructor(adapter: IStorageInterface) {
        this.adapter = adapter;
        this.entry = new EntryApi(this.adapter);
        this.state = new StateApi(this.adapter);
        this.log = new LogApi(this.adapter);
    }

    public getEntry(): EntryApi {
        return this.entry;
    }

    public getState(): StateApi {
        return this.state;
    }

    public getLog(): LogApi {
        return this.log;
    }

    public async end() {
        return new Promise((res, rej) =>
            this.adapter.close((err: Error | null) => err ? rej(err) : res())
        );
    }

}

export {MokkaStorage};
