// @ts-ignore
import {encode} from 'rlp';
import {PacketModel} from '../models/PacketModel';

export default (packet: PacketModel) => {
  return encode(JSON.stringify(packet));
};
