const net = require('net');
const log = require('../../log');

module.exports = function remoteConnect(requestOptions, socket) {
  const tunnel = net.createConnection(requestOptions, function() {
    const headers = {
      'connection': 'keep-alive'
    };

    const onerror = function(error) {
      if (error) {
        tunnel.end();
        socket.end();
        log('error', error, JSON.stringify(requestOptions));
        return;
      }

      tunnel.pipe(socket);
      socket.pipe(tunnel);
    };

    synReply(socket, 200, 'connection established', headers, onerror);
  });

  tunnel.setNoDelay(true);
  tunnel.on('error', onTargetError);

  function onTargetError(e) {
    synReply(socket, 502, "Tunnel Error", {}, function() {
      try {
        socket.end();
      } catch (e) {
        console.log('error', e)
      }
    });
  }

  function synReply(socket, code, reason, headers, cb) {
    try {
      const statusLine = `HTTP/1.1 ${code} ${reason}\r\n`;
  
      let headerLines = '';
  
      for (let key in headers) {
        headerLines += `${key}: ${headers[key]}\r\n`;
      }
  
      socket.write(`${statusLine}${headerLines}\r\n`, 'utf-8', cb);
      socket.on('error', (err) => {
        // console.log('socket err', err);
      })
    } catch (error) {
      cb(error);
    }
  }  
}