
type IWriteFunc = (packet: string) => Promise<void>;

type IInitializeFunc = () => Promise<void>;

interface IConnectionInterface {

    write: IWriteFunc;
    initialize: IInitializeFunc;

}
