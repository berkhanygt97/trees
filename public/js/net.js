const handlers = new Map();
let socket = null;
let timeOffset = 0;   // serverNow - clientNow
let latency = 0;
let clockSeeded = false;
let pingSentAt = 0;

export const net = {
  connect(name) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}`);
      const fail = () => reject(new Error('Could not reach the casino server.'));

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ t: 'join', d: { name } }));
        resolve();
      });
      socket.addEventListener('error', fail);
      socket.addEventListener('close', () => emit('__closed'));
      socket.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        // Bootstrap the clock from the first stamped message; the ping/pong
        // probe below then refines it with half the round trip.
        if (!clockSeeded && msg.d && typeof msg.d.serverNow === 'number') {
          timeOffset = msg.d.serverNow - Date.now();
          clockSeeded = true;
        }
        emit(msg.t, msg.d);
      });
    });
  },

  send(t, d) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ t, d }));
  },

  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(fn);
  },

  /** Server clock, so every client counts the same 10 minutes down. */
  now() { return Date.now() + timeOffset; },
  latency() { return latency; },
};

function emit(type, data) {
  const list = handlers.get(type);
  if (list) for (const fn of list) fn(data);
}

// Keep the clock offset honest with a lightweight round-trip probe.
net.on('pong', (d) => {
  if (!d || d.c !== pingSentAt) return;
  latency = Date.now() - pingSentAt;
  timeOffset = d.serverNow + latency / 2 - Date.now();
});

setInterval(() => {
  if (!socket || socket.readyState !== 1) return;
  pingSentAt = Date.now();
  net.send('ping', { c: pingSentAt });
}, 5000);
