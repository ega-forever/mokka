const window = self;
importScripts("bundle.js")

class EventEmitter {
  constructor () {
    this.events = {};
  }

  emit (eventName, data) {
    const event = this.events[eventName];
    if (event) {
      event.forEach(fn => {
        fn.call(null, data);
      });
    }
  }

  on (eventName, fn) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }

    this.events[eventName].push(fn);
    return () => {
      this.events[eventName] = this.events[eventName].filter(eventFn => fn !== eventFn);
    }
  }
}

class BrowserMokka extends Mokka.Mokka {

  initialize () {}

  async write (address, packet) {
    self.postMessage({type: 'packet', args: [address, packet]});
  }

  connect(){
    this.initialize();
    super.connect();
  }

}



const init = (index, keys)=>{

  window.mokka = new BrowserMokka({
    address: `${index}/${keys[index].substring(64, 128)}`,
    applier: async (command, state) => {
      let value = await state.get(command.key);
      value = (value || 0) + parseInt(command.value.value, 10);
      await state.put(command.key, value);
    },
    electionMax: 1000,
    electionMin: 300,
    gossipHeartbeat: 200,
    gossipTimeout: 200,
    heartbeat: 200,
    logger: {
      info: (text)=> console.log(`worker#${index} ${text}`),
      error: (text)=> console.log(`worker#${index} ${text}`),
      trace: (text)=> console.log(`worker#${index} ${text}`)
    },
    privateKey: keys[index]
  });

  for (let i = 0; i < keys.length; i++)
    if (i !== index)
      window.mokka.nodeApi.join(`${i}/${keys[i].substring(64, 128)}`);

  window.mokka.connect();

  window.mokka.on('error', (err) => {
     console.log(err);
  });

}

self.addEventListener('message', async function(e) {

  if(e.data.type === 'init')
    return init(...e.data.args);

  if(e.data.type === 'packet')
    window.mokka.emit('data', e.data.args[0]);

  if (e.data.type === 'push')
    window.mokka.logApi.push(...e.data.args);

  if (e.data.type === 'info')
    console.log(await window.mokka.getDb().getState().getInfo());

  if (e.data.type === 'state')
    console.log(await mokka.getDb().getState().getAll(false, 0, 100000, window.mokka.applier));


}, false);