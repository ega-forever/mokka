import crypto from 'crypto';
import secrets = require('secrets.js-grempe');

const _extract = (proof: string):
  { term: number, time: number, items: Array<{ secret: string, signature: string }> } => {

  const splitProof = proof.split('x');
  const term = parseInt(splitProof[1], 10);
  const time = parseInt(splitProof[2], 10);

  const shareWithSigs = splitProof[0].split('y').slice(1);

  const items = shareWithSigs.map((shareWithSig) => {
    const split = shareWithSig.split('g');
    return {
      secret: split[0],
      signature: split[1]
    };
  });

  return {term, time, items};

};

// todo add emitter (need to validate that leader participated as well)
const validate = (
  term: number,
  proof: string,
  rawPublicKeysMap: Map<string, string>,
  ownerPublicKey: string) => {

  const extracted = _extract(proof);

  const data: { [key: string]: string } = {};

  for (const item of extracted.items) {

    const fullPubKey = Array.from(rawPublicKeysMap.keys()).find((rawPublicKey: string) => {
      const verify = crypto.createVerify('sha256');
      verify.update(Buffer.from(item.secret));
      return verify.verify(rawPublicKey, Buffer.from(item.signature, 'hex'));
    });

    const pubKey = rawPublicKeysMap.get(fullPubKey);
    data[pubKey] = item.secret;
  }

  if (!data[ownerPublicKey]) {
    return {validated: false, minted: 0};
  }

  let comb = secrets.combine(Object.values(data));
  comb = secrets.hex2str(comb);

  return {
    minted: extracted.time,
    validated: comb === `${term}x${extracted.time}`
  };

};

export {validate};
