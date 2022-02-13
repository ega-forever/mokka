const window = self;
const path = window.location.pathname.split(/(\/*.{0,}\/workers\/)/gm, 2).find(el => el.length);
importScripts(`${path}bundle.js`);

class BrowserMokka extends Mokka.Mokka {

  initialize () {
  }

  async write (address, packet) {
    self.postMessage({type: 'packet', args: [address, packet], id: Date.now()});
  }

  connect () {
    this.initialize();
    super.connect();
  }

}

const init = (index, keys, settings) => {

  window.mokka = new BrowserMokka({
    address: `${index}/${keys[index].publicKey}`,
    crashModel: settings.crashModel,
    heartbeat: settings.heartbeat,
    electionTimeout: settings.electionTimeout,
    proofExpiration: settings.sessionExpiration, // todo move to settings
    logger: {
      info: (text) => console.log(`worker#${index} ${text}`),
      error: (text) => console.log(`worker#${index} ${text}`),
      trace: (text) => console.log(`worker#${index} ${text}`)
    },
    privateKey: keys[index].privateKey
  });

  for (let i = 0; i < keys.length; i++)
    if (i !== index)
      window.mokka.nodeApi.join(`${i}/${keys[i].publicKey}`);

  window.mokka.connect();

  window.mokka.on('state', () => {
    window.mokka.logger.info(`state: ${window.mokka.state}`);
    self.postMessage({type: 'info', args: [{state: window.mokka.state, term: window.mokka.term}]});
  });

};

self.addEventListener('message', async function (e) {

  if (!e.data)
    return;

  if (e.data.type === 'init')
    return init(...e.data.args);

  if (e.data.type === 'packet') {
    const packet = new TextDecoder('utf-8').decode(new Uint8Array(e.data.args[0]));
    window.mokka.emitPacket(packet);
  }

}, false);
