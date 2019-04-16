import {IIndexObject} from '../../gossip/types/IIndexObjectType';

class RSMStateModel {

    private _state: IIndexObject<string>;

    constructor (state: IIndexObject<string>) {
        this._state = state;
    }

    public put (key: string, value: string) {
        this._state[key] = value;
    }

    public get (key: string) {
        return this._state[key];
    }

    public del (key: string) {
        delete this._state[key];
    }

    public getState() {
        return this._state;
    }

}

export {RSMStateModel};
