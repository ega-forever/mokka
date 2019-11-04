import * as bunyan from 'bunyan';
import * as _ from 'lodash';
import states from '../../../components/consensus/constants/NodeStates';
import eventTypes from '../../../components/shared/constants/EventTypes';
import TCPMokka from '../../../implementation/TCP';

let mokka: TCPMokka = null;

const init = (params: any) => {

  const logger = bunyan.createLogger({name: 'mokka.logger', level: 50});

  mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${2000 + params.index}/${params.publicKey || params.keys[params.index].publicKey}`,
    electionMax: 300,
    electionMin: 150,
    gossipHeartbeat: 100,
    heartbeat: 50,
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
    logger.info(`index #${params.index} state ${_.invert(states)[mokka.state]}`);
  });

  mokka.gossip.on(eventTypes.GOSSIP_PEER_UPDATE, (peer: string, key: string, value: any) => {
    process.send({type: 'gossip_update', args: [peer, key, value]});
  });
};

const connect = () => {
  mokka.connect();
};

const push = (address: string, data: any) => {
  mokka.logApi.push(address, data);
};

const info = async () => {
  const info = await mokka.getDb().getState().getInfo();
  process.send({type: 'info', args: [info]});
};

const getPending = () => {
  const pendings = mokka.gossip.ownState.getPendingLogs();
  process.send({type: 'pendings', args: [pendings]});
};

const getAllPendings = () => {
  const pendings = mokka.gossip.getPendings();
  process.send({type: 'pendings_all', args: [pendings]});
};

process.on('message', (m) => {
  if (m.type === 'init')
    init(m.args[0]);

  if (m.type === 'connect')
    connect();

  if (m.type === 'push')
    push(m.args[0], m.args[1]);

  if (m.type === 'info')
    info();

  if (m.type === 'pendings')
    getPending();

  if (m.type === 'pendings_all')
    getAllPendings();

});
