const Tick = require('tick-tock'),
  tock = new Tick();

const start = Date.now();

tock.setTimeout('timeout', function () {
  console.log(`timeout by tock ${Date.now() - start}`)
}, 1000);

tock.setTimeout('timeout', function () {
  console.log(`timeout by tock ${Date.now() - start}`)
}, 1000);

//tock.clear('timeout')

/*
setTimeout(()=>{
  tock.adjust('timeout', 1000);
  console.log(`active: ${tock.active('timeout')}`)

}, 500);


setTimeout(()=>{



  tock.setTimeout('timeout', function () {
    console.log(`timeout by tock2 ${Date.now() - start}`)
  }, 1000);

}, 3000);*/
