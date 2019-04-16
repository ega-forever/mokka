import * as RLP from 'rlp';

export default (packet: Buffer) => {
  return JSON.parse(RLP.decode(packet).toString());
};
