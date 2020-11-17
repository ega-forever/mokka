import crypto from 'crypto';
import * as utils from './cryptoUtils';

export const buildVote = (
  nonce: number,
  term: number,
  candidatePublicKeyX: string,
  publicKeyXCombinations: string[][],
  privateKeyK: string,
  publicKeyX: string
) => {

  const multiPublicKeyToSigMap: Map<string, string> = new Map<string, string>();

  for (const combination of publicKeyXCombinations) {

    if (!combination.includes(candidatePublicKeyX) || !combination.includes(publicKeyX)) {
      continue;
    }

    const as = combination.map((X) => utils.buildCoefficientA(term, X));
    const combinationAiIndex = combination.indexOf(publicKeyX);
    const sharedPublicKeyX = utils.buildSharedPublicKeyX(combination, as);
    const mHash = crypto.createHash('sha256')
      .update(`${nonce}:${term}`)
      .digest('hex');
    const e = utils.buildE(sharedPublicKeyX, mHash);

    const signature = utils.buildPartialSignature(privateKeyK, as[combinationAiIndex], e);
    multiPublicKeyToSigMap.set(sharedPublicKeyX, signature);
  }

  return multiPublicKeyToSigMap;

};
