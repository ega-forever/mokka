import * as bunyan from 'bunyan';
import TCPMokka from '../../implementation/TCP';
import states from '../../components/consensus/constants/NodeStates';
import * as _ from 'lodash';

let mokka: TCPMokka = null;

const init = (params: any) => {

  mokka = new TCPMokka({
    address: `tcp://127.0.0.1:${2000 + params.index}/${params.keys[params.index].substring(64, 128)}`,
    electionMax: 300,
    electionMin: 150,
    gossipHeartbeat: 200,
    heartbeat: 100,
    logger: bunyan.createLogger({name: 'mokka.logger', level: 50}),
    privateKey: params.keys[params.index]
  });

  for (let i = 0; i < params.keys.length; i++)
    if (i !== params.index)
      mokka.nodeApi.join(`tcp://127.0.0.1:${2000 + i}/${params.keys[i].substring(64, 128)}`);

  mokka.on('error', (err) => {
     //console.log(`index #${params.index} ${err}`);
  });

  mokka.on('state', () => {
     //console.log(`index #${params.index} state ${ _.invert(states)[mokka.state]}`);
  });

  mokka.gossip.on('update', (peer: string, key: string, value: any) => {
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

});
