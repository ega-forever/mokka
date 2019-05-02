import * as bunyan from 'bunyan';
import encode from 'encoding-down';
// @ts-ignore
import * as levelup from 'levelup';
// @ts-ignore
import * as memdown from 'memdown';
import TCPMokka from '../../implementation/TCP';
let mokka: TCPMokka = null;

const init = (params: any) => {

  mokka = new TCPMokka({
    address: `/ip4/127.0.0.1/tcp/${2000 + params.index}/${params.keys[params.index].substring(64, 128)}`,
    applier: async (command: any, state: any) => {
      let value = await state.get(command.key);
      value = (value || 0) + parseInt(command.value.value, 10);
      await state.put(command.key, value);
    },
    electionMax: 1000,
    electionMin: 300,
    gossipHeartbeat: 200,
    gossipTimeout: 200,
    heartbeat: 200,
    logger: bunyan.createLogger({name: 'mokka.logger', level: 60}),
    privateKey: params.keys[params.index],
    storage: levelup(encode(memdown(),  {valueEncoding: 'json', keyEncoding: 'binary'}))
  });

  for (let i = 0; i < params.keys.length; i++)
    if (i !== params.index)
      mokka.nodeApi.join(`/ip4/127.0.0.1/tcp/${2000 + i}/${params.keys[i].substring(64, 128)}`);

// @ts-ignore
  mokka.on('error', (err) => {
    // console.log(err);
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

const getState = async () => {
  const state = await mokka.getDb().getState().getAll(false, 0, 100000, mokka.applier);
  process.send({type: 'state', args: [state]});

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

  if (m.type === 'state')
    getState();

});
