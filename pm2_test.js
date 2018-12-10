const {spawn} = require('child_process');

let prc = spawn('npm.cmd', ['run', 'test'], {env: process.env, stdio: 'inherit'});
