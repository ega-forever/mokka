import * as RLP from 'rlp';
import {PacketModel} from '../models/PacketModel';

export default (packet: PacketModel) => {
  return RLP.encode(JSON.stringify(packet));
};
