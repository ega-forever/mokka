// @ts-ignore
import {decode} from 'rlp';

export default (packet: Buffer) => {
  return JSON.parse(decode(packet).toString());
};
