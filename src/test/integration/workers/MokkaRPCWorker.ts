import * as bunyan from 'bunyan';
import * as _ from 'lodash';
import eventTypes from '../../../consensus/constants/EventTypes';
import states from '../../../consensus/constants/NodeStates';
import {PacketModel} from '../../../consensus/models/PacketModel';
import RPCMokka from '../../../implementation/RPC';

let mokka: RPCMokka = null;

const init = (params: any) => {

  const logger = bunyan.createLogger({name: `mokka.logger[${params.index}]`, level: 10});

  logger.trace(`params ${JSON.stringify(params)}`);

  mokka = new RPCMokka({
    address: `http://127.0.0.1:${2000 + params.index}/${params.publicKey || params.keys[params.index].publicKey}`,
    crashModel: params.settings.crashModel,
    electionTimeout: params.settings.electionTimeout,
    heartbeat: params.settings.heartbeat,
    logger,
    privateKey: params.keys[params.index].privateKey,
    proofExpiration: params.settings.proofExpiration,
    reqMiddleware: async (packet: PacketModel) => {
      return packet;
    }
  });

  for (let i = 0; i < params.keys.length; i++)
    if (i !== params.index)
      mokka.nodeApi.join(`http://127.0.0.1:${2000 + i}/${params.keys[i].publicKey}`);

  mokka.on(eventTypes.STATE, () => {
    logger.info(`index #${params.index} state ${_.invert(states)[mokka.state]} with term ${mokka.term}`);
    process.send({type: 'state', args: [mokka.state, mokka.leaderPublicKey, mokka.term, params.index]});
  });

  mokka.on(eventTypes.HEARTBEAT_TIMEOUT, () => {
    logger.info(`index #${params.index} timeout with term ${mokka.term}`);
  });

};

const connect = () => {
  mokka.connect();
};

process.on('message', (m: any) => {
  if (m.type === 'init')
    init(m.args[0]);

  if (m.type === 'connect')
    connect();
});
