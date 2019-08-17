import Promise from 'bluebird';
import {Buffer} from 'buffer';
import bunyan from 'bunyan';
import {expect} from 'chai';
import * as nacl from 'tweetnacl';
import TCPMokka from '../../../implementation/TCP';
import {LogApi} from '../../../components/consensus/api/LogApi';
import {Mokka} from '../../../components/consensus/main';
import NodeStates from '../../../components/consensus/constants/NodeStates';
import {StateModel} from '../../../components/storage/models/StateModel';
import {createHmac} from 'crypto';
import messageTypes from '../../../components/consensus/constants/MessageTypes';
import {validate} from '../../../components/consensus/utils/proofValidation';

describe('ProofValidationApi tests', (ctx = {}) => {

  beforeEach(async () => {

    ctx.keys = [];

    ctx.nodes = [];

    for (let index = 0; index < 3; index++) {
      ctx.keys.push(Buffer.from(nacl.sign.keyPair().secretKey).toString('hex'));
    }

    for (let index = 0; index < 3; index++) {
      const instance = new TCPMokka({
        address: `tcp://127.0.0.1:2000/${ctx.keys[index].substring(64, 128)}`,
        electionMax: 1000,
        electionMin: 300,
        gossipHeartbeat: 200,
        heartbeat: 200,
        logger: bunyan.createLogger({name: 'mokka.logger', level: 60}),
        privateKey: ctx.keys[index]
      });

      for (let i = 0; i < 3; i++)
        if (i !== index)
          instance.nodeApi.join(`tcp://127.0.0.1:${2000 + i}/${ctx.keys[i].substring(64, 128)}`);

      ctx.nodes.push(instance);
    }

  });

  it('should validate the proof', async () => {

    const proof = '3x805da0ab6c98d9bdb69dfe002b6b8b3dd27d15a821e1b5ce6b12b85453bec06f06b05ffd4904f654ecdd99dc7b60e24babd95bd3f2bbd9f0e92fa6f369\n' +
      '83c838a28c99b4fe7ff855f0ee1eeb624ab70043c75b3e2c34163e0b1036f416a917c600d804a8acce731ec7cb9f98c0112f4fecf402b93e9fe1bb7629c69ada\n' +
      '64c660d4db8fa346514cf430d056d27323bfacc2ae79e96e5fd2713a5fd44920487a80b9d59a871d932ac48f5ec197f500c9e9d7d36011a1898aa92dd9a509f5\n' +
      'f8b7dc42910a8030d7a0eda4f65822f7ccf5517321163124d54852f8764b0dd2be9b8259abde58d6d4c63c01f313aafd21c83432a7eb1c508fbd57b9b566d534\n' +
      '881b7551b5a01d4df19fd184c386e8b635d1cdccc8b390a83ee8631b5a29e72611b32153d180e0fx1x1566037107051';
    const term = 1;

    const pubKeys = ctx.nodes.map((node) => node.publicKey);

    const result = validate(term, proof, null, pubKeys);

    console.log(result);

  });

  afterEach(async () => {
    await Promise.delay(1000);
  });

});
