import express from 'express';
import path from 'path';
import socketio from 'socket.io';

const io = socketio(3000);
const app = express();

const clients = {};

app.use('/mokka', express.static(path.join(__dirname, '../node_modules/mokka/dist/web')));
app.use('/socket.io', express.static(path.join(__dirname, '../node_modules/socket.io-client/dist')));
app.use('/', express.static(path.join(__dirname, 'public')));

io.sockets.on('connection', (socket) => {
  socket.on('data', (data) => {
    if (!clients[data[0]])
      return;

    clients[data[0]].emit('data', data[1]);
  });

  socket.once('pub_key', (publicKey) => {
    clients[publicKey] = socket;
    socket.publicKey = publicKey;
    console.log(`client registered: ${publicKey}`);
  });

  socket.once('disconnect', (reason) => {
    console.log(`client (${socket.publicKey}) disconnected: ${reason}`);
    delete clients[socket.publicKey];
  });

});

app.listen(8080, () => {
  console.log('server started!');
});
