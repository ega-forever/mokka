import * as utils from './cryptoUtils';

export const buildVote = (
  nonce: number,
  term: number,
  sharedPublicKeyX: string,
  privateKeyK: string,
) => {
  return utils.buildPartialSignature(privateKeyK, term, nonce, sharedPublicKeyX);
};
