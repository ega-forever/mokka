class BrowserMokka extends Mokka.Mokka {

  constructor (settings) {
    super(settings);
    this.socket = io('http://localhost:3000');
  }

  async initialize () {

    await new Promise(res => this.socket.on('connect', res));

    this.socket.emit('pub_key', this.publicKey);
    this.socket.on('data', data => {
      const packet = new TextDecoder("utf-8").decode(new Uint8Array(data.data));
      window.mokka.emit('data', packet);
    });

    this.socket.on('connect_error', console.log);
    this.socket.on('error', console.log);
  }

  async write (address, packet) {
    const node = Array.from(this.nodes.values()).find(node => node.address === address);
    this.socket.emit('data', [node.publicKey, packet]);
  }

  async connect () {
    await this.initialize();
    super.connect();
  }

}