import * as encode from 'encoding-down';
// @ts-ignore
import * as levelup from 'levelup';
// @ts-ignore
import * as memdown from 'memdown';
import {EntryApi} from './api/EntryApi';
import {LogApi} from './api/LogApi';
import {StateApi} from './api/StateApi';

class MokkaStorage {
    private adapter: any;
    private path: string;
    private entry: EntryApi;
    private state: StateApi;
    private log: LogApi;

    constructor(adapter: any = memdown, path: string) {
        this.path = path;
        // @ts-ignore
        this.adapter = levelup(encode(adapter(`${path}_db`), {valueEncoding: 'json', keyEncoding: 'binary'}));
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
