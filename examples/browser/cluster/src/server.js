const express = require('express'),
  path = require('path'),
  io = require('socket.io')(3000),
  app = express();

const clients = {};

app.use('/mokka', express.static(path.join(__dirname, '../node_modules/mokka/dist/web')));
app.use('/socket.io', express.static(path.join(__dirname, '../node_modules/socket.io-client/dist')));
app.use('/', express.static(path.join(__dirname, 'public')));

io.sockets.on('connection', function (socket) {
  socket.on('data', (data)=>{
    if(!clients[data[0]])
      return;

    clients[data[0]].emit('data', data[1]);
  });

  socket.once('pub_key', publicKey => {
    clients[publicKey] = socket;
    console.log(publicKey)
  });

});

app.listen(8080, () => {
  console.log('server started!');
});