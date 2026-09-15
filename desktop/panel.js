'use strict';

const $ = (id) => document.getElementById(id);
const FIELDS = ['roundMinutes', 'startCash', 'loanAmount', 'port'];

const FIREWALL = {
  win32: `<p><b>Windows</b> — the first time you host, Windows asks whether to let
          Node.js communicate on the network. Tick <b>Private networks</b> and allow it.
          If you dismissed that box: Windows Security → Firewall &amp; network protection →
          Allow an app through firewall → find <b>Node.js</b> and tick Private.</p>`,
  darwin: `<p><b>macOS</b> — System Settings → Network → Firewall → Options, then allow
           incoming connections for <b>Casino Royale</b> (or <b>node</b>). macOS usually
           prompts the first time you host; if you clicked Deny, this is where to undo it.</p>`,
  linux: `<p><b>Linux</b> — if you use ufw: <b>sudo ufw allow PORT/tcp</b>. With firewalld:
          <b>sudo firewall-cmd --add-port=PORT/tcp</b>.</p>`,
};

let editing = false;
let lastSettings = null;

// Don't fight the host while they are typing in a rules field.
for (const id of FIELDS) {
  const el = $(id);
  el.addEventListener('focus', () => { editing = true; });
  el.addEventListener('blur', () => { editing = false; });
}

$('play').addEventListener('click', async () => {
  await window.host.openGame();
});

$('apply').addEventListener('click', async () => {
  const next = {};
  for (const id of FIELDS) next[id] = Number($(id).value);
  $('apply').disabled = true;
  $('apply').textContent = 'RESTARTING…';
  const state = await window.host.restart(next);
  $('apply').disabled = false;
  $('apply').textContent = 'APPLY & RESTART THE FLOOR';
  render(state);
});

function copyButton(url) {
  const b = document.createElement('button');
  b.textContent = 'COPY';
  b.addEventListener('click', async () => {
    await window.host.copy(url);
    b.textContent = 'COPIED';
    b.classList.add('copied');
    setTimeout(() => { b.textContent = 'COPY'; b.classList.remove('copied'); }, 1400);
  });
  return b;
}

function renderLinks(state) {
  const box = $('links');
  box.replaceChildren();

  if (!state.running) {
    const row = document.createElement('div');
    row.className = 'link none';
    row.textContent = 'The floor is closed — fix the port below and restart.';
    box.appendChild(row);
    $('same-machine').textContent = '';
    return;
  }

  if (!state.lanUrls.length) {
    const row = document.createElement('div');
    row.className = 'link none';
    row.textContent = 'No network address found. Are you connected to Wi-Fi or Ethernet?';
    box.appendChild(row);
  }

  for (const url of state.lanUrls) {
    const row = document.createElement('div');
    row.className = 'link';
    const code = document.createElement('code');
    code.textContent = url;
    row.append(code, copyButton(url));
    box.appendChild(row);
  }

  $('same-machine').textContent =
    `On this machine you can also use ${state.localUrl}. `
    + (state.lanUrls.length > 1 ? 'Several addresses means several networks — hand out the one your guests are on.' : '');
}

function renderPlayers(state) {
  const list = $('players');
  list.replaceChildren();
  $('empty').hidden = state.players.length > 0;

  state.players.forEach((p, i) => {
    const li = document.createElement('li');

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `${i + 1}.`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = p.name;

    const pf = document.createElement('span');
    pf.className = `pf ${p.profit > 0 ? 'up' : p.profit < 0 ? 'down' : 'flat'}`;
    const sign = p.profit > 0 ? '+' : p.profit < 0 ? '-' : '±';
    pf.textContent = `${sign}$${Math.abs(p.profit).toLocaleString('en-US')}`;

    li.append(rank, dot, nm);
    if (p.loans) {
      const b = document.createElement('span');
      b.className = 'borrowed';
      b.textContent = `borrowed $${p.loans.toLocaleString('en-US')}`;
      li.append(b);
    }
    li.append(pf);
    list.appendChild(li);
  });
}

function render(state) {
  if (!state) return;

  $('dot').className = state.running ? 'up' : 'down';
  $('state-text').textContent = state.running
    ? `HOSTING ON PORT ${state.port}`
    : 'NOT HOSTING';

  $('notice').hidden = !state.notice;
  if (state.notice) $('notice').textContent = state.notice;

  renderLinks(state);
  $('play').disabled = !state.running;

  const r = state.round;
  if (r && r.phase !== 'lobby') {
    const m = Math.floor(r.secondsLeft / 60);
    const s = r.secondsLeft % 60;
    $('round-label').textContent = r.phase === 'live'
      ? `ROUND ${r.number} · LIVE`
      : `ROUND ${r.number} OVER · NEXT ROUND IN`;
    $('round-clock').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('round-clock').classList.toggle('urgent', r.phase === 'live' && r.secondsLeft <= 60);
  } else {
    $('round-label').textContent = state.running ? 'WAITING FOR PLAYERS' : '—';
    $('round-clock').textContent = '--:--';
    $('round-clock').classList.remove('urgent');
  }

  $('event').hidden = !(r && r.event);
  if (r && r.event) $('event').textContent = r.event;

  renderPlayers(state);

  const key = JSON.stringify(state.settings);
  if (!editing && key !== lastSettings) {
    lastSettings = key;
    for (const id of FIELDS) $(id).value = state.settings[id];
  }

  const help = FIREWALL[state.platform] || FIREWALL.linux;
  $('firewall').innerHTML = help.replace(/PORT/g, String(state.port));
}

window.host.onUpdate(render);
window.host.status().then(render);
