import {EventEmitter} from 'events';

interface ICreateReadStreamOptions {
  gt?: string;
  lt?: string;
  limit?: number;
}

export interface IStorageInterface {

  del(index: string): Promise<void>;

  get(index: string): Promise<any>;

  put(index: string, data: any): Promise<void>;

  createReadStream(options: ICreateReadStreamOptions): EventEmitter;

  createKeyStream(options: ICreateReadStreamOptions): EventEmitter;

  close(cb: (err: Error | null) => void): void;

}
