import EventEmitter = NodeJS.EventEmitter;

export interface IStorageInterface {

  del(index: string): Promise<void>;

  get(index: string): Promise<any>;

  put(index: string, data: any): Promise<void>;

  createReadStream(options: any): EventEmitter;

  createKeyStream(options: any): EventEmitter;

  close(cb: any): void;

}
