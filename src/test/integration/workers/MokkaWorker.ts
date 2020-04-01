import * as bunyan from 'bunyan';
import * as _ from 'lodash';
import eventTypes from '../../../consensus/constants/EventTypes';
import states from '../../../consensus/constants/NodeStates';
import TCPMokka from '../../../implementation/TCP';

let mokka: TCPMokka = null;

const init = (params: any) => {

  const logger = bunyan.createLogger({name: 'mokka.logger', level: 30});

  mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${2000 + params.index}/${params.publicKey || params.keys[params.index].publicKey}`,
    heartbeat: 100,
    logger,
    privateKey: params.keys[params.index].privateKey,
    proofExpiration: 5000
  });

  for (let i = 0; i < params.keys.length; i++)
    if (i !== params.index)
      mokka.nodeApi.join(`tcp://127.0.0.1:${2000 + i}/${params.keys[i].publicKey}`);

  mokka.on(eventTypes.ERROR, (err) => {
    logger.error(`index #${params.index} ${err}`);
  });

  mokka.on(eventTypes.STATE, () => {
    logger.info(`index #${params.index} state ${_.invert(states)[mokka.state]} with term ${mokka.term}`);
    process.send({type: 'state', args: [mokka.state, mokka.leaderPublicKey]});
  });

};

const connect = () => {
  mokka.connect();
};

process.on('message', (m) => {
  if (m.type === 'init')
    init(m.args[0]);

  if (m.type === 'connect')
    connect();
});
