import transform from 'lodash/transform';
import values from 'lodash/values';
// @ts-ignore
import secrets from 'secrets.js-grempe';
import nacl from 'tweetnacl';

const _extract = (proof: string): { time: number, items: Array<{ secret: string, signature: string }> } => {

  const items = [];

  const splitProof = proof.split('x');
  const itemsAmount = parseInt(splitProof[0], 10);
  proof = splitProof[1];

  const time = parseInt(proof.substr(proof.length - 13, proof.length), 10);
  proof = proof.substr(0, proof.length - 13);
  const offset = proof.length / itemsAmount;
  const secretSize = offset - 128;

  for (let index = 0; index < proof.length; index += offset) {
    const item = proof.substr(index, index + offset);

    const secret = item.substr(0, secretSize);
    const signature = item.substr(secretSize, 128);

    items.push({secret, signature});
  }

  return {time, items};

};

const validate = (term: number, proof: string, currentProof: string, publicKeys: string[]) => {

  if (currentProof && currentProof === proof)
    return true;

  const extracted = _extract(proof);

  const items = values(
    transform(extracted.items, (result, item) => {

      const pubKey = publicKeys.find((publicKey: string) =>
        nacl.sign.detached.verify(
          Buffer.from(item.secret),
          Buffer.from(item.signature, 'hex'),
          Buffer.from(publicKey, 'hex')
        )
      );

      result[pubKey] = item.secret;
      return result;
    }, {})
  );

  let comb = secrets.combine(items);
  comb = secrets.hex2str(comb);

  return comb === extracted.time.toString();

};

export {validate};
