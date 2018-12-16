const speakeasy = require('speakeasy');


let token = speakeasy.totp({
  secret: '123',
  //step: this.election.max / 1000
  step: 30, //todo resolve timing calculation
  window: 2
});


console.log(token)


let token2 = speakeasy.totp({
  secret: '1234567',
  //step: this.election.max / 1000
  step: 30, //todo resolve timing calculation
  window: 2
});


console.log(token2)