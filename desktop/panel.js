'use strict';

const $ = (id) => document.getElementById(id);
const FIELDS = ['startCash', 'port', 'raidMode'];
const TEXT_FIELDS = new Set(['raidMode']);

const FIREWALL = {
  win32: `<p><b>Windows</b> — the first time you host, Windows asks whether to let
          <b>Harvest Royale</b> communicate on the network. Tick <b>Private networks</b> and allow it.
          If you dismissed that box: Windows Security → Firewall &amp; network protection →
          Allow an app through firewall → find <b>Harvest Royale</b> and tick Private.</p>`,
  darwin: `<p><b>macOS</b> — System Settings → Network → Firewall → Options, then allow
           incoming connections for <b>Harvest Royale</b> (or <b>node</b>). macOS usually
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

$('open-saves').addEventListener('click', () => window.host.openSaves());
$('save-now').addEventListener('click', async () => {
  $('save-now').textContent = 'SAVED';
  render(await window.host.saveNow());
  setTimeout(() => { $('save-now').textContent = 'SAVE NOW'; }, 1400);
});
$('choose-saves').addEventListener('click', async () => render(await window.host.chooseSaves()));

$('apply').addEventListener('click', async () => {
  const next = {};
  for (const id of FIELDS) next[id] = TEXT_FIELDS.has(id) ? $(id).value : Number($(id).value);
  $('apply').disabled = true;
  $('apply').textContent = 'RESTARTING…';
  const state = await window.host.restart(next);
  $('apply').disabled = false;
  $('apply').textContent = 'SAVE & RESTART THE SERVER';
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
    row.textContent = 'The server is not running — fix the port below and restart.';
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
    if (!p.online) li.className = 'off';

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `${i + 1}.`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = `${p.name}${p.online ? '' : ' (offline)'}`;

    const lv = document.createElement('span');
    lv.className = 'borrowed';
    lv.textContent = `lvl ${p.level}`;

    const pf = document.createElement('span');
    pf.className = 'pf up';
    pf.textContent = `$${p.netWorth.toLocaleString('en-US')}`;

    li.append(rank, dot, nm, lv, pf);
    list.appendChild(li);
  });
}

const WEATHER = { clear: '☀️ clear', cloudy: '⛅ cloudy', rain: '🌧️ rain', storm: '⛈️ storm' };

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

  const wd = state.world;
  if (wd) {
    $('round-label').textContent = `DAY ${wd.day} · ${WEATHER[wd.weather] || wd.weather}`;
    $('round-clock').textContent = `${String(wd.hour).padStart(2, '0')}:${String(wd.minute).padStart(2, '0')}`;
  } else {
    $('round-label').textContent = '—';
    $('round-clock').textContent = '--:--';
  }
  $('event').hidden = !(wd && wd.event);
  if (wd && wd.event) $('event').textContent = `Casino: ${wd.event}`;

  const sv = state.saves || {};
  $('save-dir').textContent = sv.dir || '—';
  const ago = sv.lastSaveAt ? Math.round((Date.now() - sv.lastSaveAt) / 1000) : null;
  $('save-info').textContent = `${sv.files || 0} player save${sv.files === 1 ? '' : 's'}`
    + (ago != null ? ` · last saved ${ago < 5 ? 'just now' : `${ago}s ago`}` : ' · not saved yet this session');

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
