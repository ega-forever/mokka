import * as utils from '../../proof/cryptoUtils';

export const buildVote = (
  nonce: number,
  candidatePublicKey: string,
  candidateTerm: number,
  multiPublicKeyToPublicKeyHashAndPairsMap: Map<string, { pairs: string[], hash: string }>,
  ownPrivateKey: string,
  ownPublicKey: string
) => {

  // assert(Date.now() - payload.nonce < this.voteSession.expireIn); // todo move to vote

  const multiPublicKeyToSigMap: Map<string, string> = new Map<string, string>();

  for (const publicKeyCombined of multiPublicKeyToPublicKeyHashAndPairsMap.keys()) {
    const multiPublicKeyData = multiPublicKeyToPublicKeyHashAndPairsMap.get(publicKeyCombined);

    if (!multiPublicKeyData.pairs.includes(candidatePublicKey)) {
      continue;
    }

    const {nonce: nonceCombined, nonceIsNegated} = utils.buildCombinedNonce(
      candidateTerm,
      nonce,
      multiPublicKeyData.pairs,
      publicKeyCombined
    );

    const sig = utils.partialSign(
      candidateTerm,
      nonce,
      ownPrivateKey,
      ownPublicKey,
      multiPublicKeyData.pairs.indexOf(ownPublicKey),
      nonceCombined,
      publicKeyCombined,
      multiPublicKeyData.hash,
      nonceIsNegated
    );

    multiPublicKeyToSigMap.set(publicKeyCombined, sig);
  }

  return multiPublicKeyToSigMap;

};
