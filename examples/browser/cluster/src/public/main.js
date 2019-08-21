const index = window.location.hash.replace('#', '');


// our generated key pairs
const keys = [
  {
    publicKey: '04753d8ac376feba54fabbd7b4cdc512a4350d15e566b4e7398682d13b7a4cf08714182ba08e3b0f7ee61ee857e96dc1799b8f58c61b26ad25b1aa762a9964377a',
    secretKey: 'e3b1e663155437f1810a8c474ddda497bf4a030060374d78dac7cea4dee4e774'
  },
  {
    publicKey: '04b5ef92009db5362540b9416a3bfd4733597b132660e6e50b9b80b4779dae3834eb5c27fdc8767208edafc3b083d353228cb9531ca6e7dda2e9e8990dc1673b1f',
    secretKey: '3cceb8344ddab063cb1c99bf33985bc123a1b85a180baedfd22681471b2541e8'
  },
  {
    publicKey: '04d0c169903b05cd1444f33e14b6feeed8215b232b7be2922e65f3f4d9865cf2148861cd2b3580689fb50ce840c04def59740490230dab76f6645ab159bd6b95c3',
    secretKey: 'fc5c3b5c2366df10b78579751faac46a4507deb205266335c7d9968a0976750b'
  }
];


window.mokka = new BrowserMokka({
  address: `${index}/${keys[index].publicKey}`,
  electionMax: 300,
  electionMin: 100,
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