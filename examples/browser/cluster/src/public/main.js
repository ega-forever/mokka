const index = window.location.hash.replace('#', '');


// our generated key pairs
const keys = [
  {
    publicKey: 'd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb',
    secretKey: '4ca246e3ab29c0085b5cbb797f86e6deea778c6e6584a45764ec10f9e0cebd7fd6c922bc69a0cc059565a80996188d11d29e78ded4115b1d24039ba25e655afb'
  },
  {
    publicKey: 'a757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba',
    secretKey: '931f1c648e1f87b56cd22e8de7ed235b9bd4ade9696c9d8c75f212a1fa401d5da757d4dbbeb8564e1a3575ba89a12fccaacf2940d86c453da8b3f881d1fcfdba'
  },
  {
    publicKey: '009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c',
    secretKey: '7144046b5c55f38cf9b3b7ec53e3263ebb01ed7caf46fe8758d6337c87686077009d53a3733c81375c2b5dfd4e7c51c14be84919d6e118198d35afd80965a52c'
  }
];


window.mokka = new BrowserMokka({
  address: `${index}/${keys[index].publicKey}`,
  electionMax: 1000,
  electionMin: 300,
  gossipHeartbeat: 200,
  heartbeat: 100,
  privateKey: keys[index].secretKey
});

for (let i = 0; i < keys.length; i++)
  if (i !== index)
    window.mokka.nodeApi.join(`${i}/${keys[i].publicKey}`);

window.mokka.connect();

window.mokka.on('error', (err) => {
  console.log(err);
});

window.mokka.on('log', async (index)=>{
  const info = await window.mokka.getDb().getState().getInfo();
  console.log(info);
});