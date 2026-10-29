'use strict';
(function () {

  /* ---------- Costanti ---------- */

  const APP_VERSION = 'v6';
  const STORE_KEY = 'scoutvolley.db.v1';
  const BACKUP_KEY = 'scoutvolley.lastBackup';
  const SEL_TIMEOUT = 3000;

  const ROLES = [['P', 'Palleggiatore'], ['S', 'Schiacciatore'], ['C', 'Centrale'], ['O', 'Opposto'], ['L', 'Libero']];
  const ROLE_NAME = Object.fromEntries(ROLES);

  // Esiti per fondamentale: [codice, stile, colonne occupate]
  const FUNDS = [
    { key: 'B', label: 'Battuta', short: 'Bat', out: [['#', 'best', 1], ['+', 'good', 1], ['-', 'poor', 1], ['=', 'err', 1]] },
    { key: 'R', label: 'Ricezione', short: 'Ric', out: [['#+', 'best', 2], ['-', 'poor', 1], ['/=', 'err', 1]] },
    { key: 'A', label: 'Attacco', short: 'Att', out: [['#', 'best', 1], ['+-', 'mid', 1], ['/', 'bad', 1], ['=', 'err', 1]] },
    { key: 'M', label: 'Muro', short: 'Muro', out: [['#', 'best', 1]] }
  ];
  const FUND = Object.fromEntries(FUNDS.map(f => [f.key, f]));
  const KIND = {};
  FUNDS.forEach(f => f.out.forEach(o => { KIND[f.key + o[0]] = o[1]; }));

  const METRIC = {
    B: { label: 'Eff%', calc: v => v[0] + v[1] - v[2] - v[3], note: 'Eff% battuta = ((# + +) − (- + =)) / totale' },
    R: { label: 'Pos%', calc: v => v[0], note: 'Pos% ricezione = #+ / totale' },
    A: { label: 'Eff%', calc: v => v[0] - v[2] - v[3], note: 'Eff% attacco = (# − / − =) / totale' },
    M: null
  };

  const svg = (d, size = 22, extra = '') =>
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const I = {
    back: svg('<path d="M15 18l-6-6 6-6"/>', 24),
    close: svg('<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'),
    plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 20, 'stroke-width="2.4"'),
    play: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/>'),
    users: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21v-1a6 6 0 0 0-4-5.6"/>'),
    chart: svg('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 18),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 18),
    swap: svg('<path d="M7 4L3 8l4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/>', 18),
    list: svg('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>', 18),
    upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>', 18),
    trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 18),
    chev: svg('<path d="M9 18l6-6-6-6"/>', 18, 'stroke="#6B7280"'),
    down: svg('<path d="M6 9l6 6 6-6"/>', 16),
    check: svg('<path d="M20 6L9 17l-5-5"/>', 20)
  };

  /* ---------- Dati ---------- */

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Versione 2: più squadre, ognuna con i suoi giocatori ed eventi.
  // I dati della versione 1 (una sola squadra in db.team) finiscono nella prima squadra.
  function normalize(d) {
    if (!d || typeof d !== 'object') d = {};
    const teams = Array.isArray(d.teams) ? d.teams.filter(t => t && t.id) : [];
    if (!teams.length) teams.push({ id: uid(), name: (d.team && d.team.name) || '' });
    const ids = new Set(teams.map(t => t.id));
    const fix = x => { if (!ids.has(x.teamId)) x.teamId = teams[0].id; return x; };
    return {
      version: 2,
      teams,
      curTeamId: ids.has(d.curTeamId) ? d.curTeamId : teams[0].id,
      players: Array.isArray(d.players) ? d.players.map(fix) : [],
      events: Array.isArray(d.events) ? d.events.map(fix) : [],
      actions: Array.isArray(d.actions) ? d.actions : []
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* dati illeggibili: si riparte vuoti */ }
    return normalize(null);
  }
  let db = load();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { toast('Errore nel salvataggio: memoria del telefono piena?'); }
  }
  save();

  const curTeam = () => db.teams.find(t => t.id === db.curTeamId) || db.teams[0];
  const teamName = t => (t && t.name) || 'La tua squadra';
  const teamPlayers = (tid = curTeam().id) => db.players.filter(p => p.teamId === tid);
  const teamEvents = () => db.events.filter(e => e.teamId === curTeam().id);
  const playerById = id => db.players.find(p => p.id === id);
  const P = id => playerById(id) || { id, num: '?', last: 'Eliminato', first: '', role: '' };
  const eventById = id => db.events.find(e => e.id === id);
  const actionsOf = evId => db.actions.filter(a => a.eventId === evId);
  const isLibero = id => P(id).role === 'L';
  const byNum = (a, b) => (Number(a.num) || 0) - (Number(b.num) || 0);
  const activePlayers = tid => teamPlayers(tid).filter(p => p.active !== false).sort(byNum);
  const fullName = p => [p.last, p.first].filter(Boolean).join(' ');

  /* ---------- Utilità ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseIso(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    return new Date(y || 2000, (m || 1) - 1, d || 1);
  }
  function fmtDate(iso) {
    const d = parseIso(iso);
    const wd = d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
    const mo = d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '');
    return { d: d.getDate(), m: mo, wd, long: `${wd.charAt(0).toUpperCase() + wd.slice(1)} ${d.getDate()} ${mo} ${d.getFullYear()}` };
  }
  const evTitle = ev => ev.type === 'training' ? 'Allenamento' : 'vs ' + (ev.opponent || 'Avversario');
  const evSub = ev => [fmtDate(ev.date).long, ev.type === 'training' ? 'Allenamento' : (ev.venue === 'away' ? 'Trasferta' : 'Casa')].join(' · ');
  const sum = v => v.reduce((a, b) => a + b, 0);
  const pct = (n, tot) => tot ? Math.round(n / tot * 100) + '%' : '–';

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* non supportato */ } }

  async function shareOrDownload(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return true;
  }
  const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /* ---------- Stato dell'interfaccia ---------- */

  const ui = {
    evFilter: 'all',
    live: { evId: null, sel: null, msg: null, msgKind: '', subMode: false, subIn: null },
    stat: { type: 'all', set: 0, tab: 'A' },
    modal: null
  };
  let selTimer = null;
  let lastKey = '';

  function route() {
    return (location.hash.replace(/^#\/?/, '') || 'eventi').split('/').filter(Boolean);
  }
  const go = hash => { location.hash = hash; };

  /* ---------- Componenti comuni ---------- */

  function nav(active) {
    const item = (href, key, icon, label) =>
      `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
    return `<nav class="nav" aria-label="Sezioni">
      ${item('#/eventi', 'eventi', I.cal, 'Eventi')}
      ${item('#/squadra', 'squadra', I.users, 'Squadra')}
      ${item('#/stat', 'stat', I.chart, 'Statistiche')}
    </nav>`;
  }
  // Nome della squadra in intestazione: toccandolo si cambia squadra o se ne crea una nuova
  function teamPicker() {
    return `<button class="eyebrow team-pick" data-act="openTeams" aria-label="Squadra: ${esc(teamName(curTeam()))}. Cambia squadra">
      <span>${esc(teamName(curTeam()))}</span>${I.down}</button>`;
  }
  function seg(act, options, current, label) {
    return `<div class="seg" role="group" aria-label="${esc(label)}">${options.map(([v, l]) =>
      `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${String(v) === String(current)}">${esc(l)}</button>`).join('')}</div>`;
  }

  /* ---------- Eventi ---------- */

  function needsBackup() {
    if (!db.actions.length) return false;
    const last = Number(localStorage.getItem(BACKUP_KEY) || 0);
    const newest = Math.max(...db.actions.map(a => a.t || 0));
    return newest > last && Date.now() - last > 7 * 864e5;
  }

  function eventCard(ev, next) {
    const acts = actionsOf(ev.id);
    const sets = acts.length ? Math.max(...acts.map(a => a.set)) : 0;
    const fd = fmtDate(ev.date);
    const meta = [
      ev.type === 'training' ? null : (ev.venue === 'away' ? 'Trasferta' : 'Casa'),
      sets ? sets + (sets === 1 ? ' set' : ' set') : null,
      acts.length + ' azioni'
    ].filter(Boolean).join(' · ');
    return `<div class="card ${next ? 'next' : ''}">
      <div class="ev-top">
        <div class="datebox"><div class="d">${fd.d}</div><div class="m">${esc(fd.m)}</div></div>
        <div style="flex:1;min-width:0">
          <div class="ev-title">${esc(evTitle(ev))}</div>
          <div class="ev-meta">${esc(fd.wd)} · ${esc(meta)}</div>
        </div>
        <span class="chip ${ev.type === 'training' ? '' : 'match'}">${ev.type === 'training' ? 'Allenamento' : 'Partita'}</span>
      </div>
      <div class="ev-actions">
        <a class="btn ${next ? 'btn-primary' : ''} btn-sm" href="#/evento/${ev.id}/live">${I.play}<span>Rileva</span></a>
        <a class="btn btn-sm" href="#/stat/${ev.id}">${I.chart}<span>Statistiche</span></a>
        <a class="btn btn-sm" href="#/evento/${ev.id}/modifica" aria-label="Modifica evento" style="padding:0">${I.edit}</a>
      </div>
    </div>`;
  }

  function viewEventi() {
    const today = todayIso();
    const f = ui.evFilter;
    const evs = teamEvents().filter(e => f === 'all' || (f === 'match' ? e.type !== 'training' : e.type === 'training'));
    const upcoming = evs.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = evs.filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    let body = '';
    if (!teamPlayers().length) {
      body += db.players.length
        ? `<div class="card empty"><strong>Squadra senza giocatori</strong><span>Inserisci la rosa di questa squadra.</span><a class="btn btn-primary" href="#/squadra">Configura la squadra</a></div>`
        : `<div class="card empty"><strong>Benvenuto!</strong><span>Per iniziare inserisci il nome della squadra e i giocatori.</span><a class="btn btn-primary" href="#/squadra">Configura la squadra</a></div>`;
    }
    if (needsBackup()) {
      body += `<div class="banner"><span>Ci sono dati non salvati in un backup.</span><button class="btn btn-sm" data-act="openBackup">Backup</button></div>`;
    }
    body += seg('evFilter', [['all', 'Tutti'], ['match', 'Partite'], ['training', 'Allenamenti']], f, 'Filtro eventi');
    if (!evs.length) {
      body += `<div class="empty"><strong>Nessun evento</strong><span>Crea una partita o un allenamento con il tasto “Nuovo evento”.</span></div>`;
    }
    if (upcoming.length) {
      body += `<h2 class="section-title">Prossimi</h2><div class="cards">${upcoming.map((e, i) => eventCard(e, i === 0)).join('')}</div>`;
    }
    if (past.length) {
      body += `<h2 class="section-title">Passati</h2><div class="cards">${past.map(e => eventCard(e, false)).join('')}</div>`;
    }
    return `<header class="hdr">
        <div>${teamPicker()}<h1>Eventi</h1></div>
      </header>
      <main class="main with-fab">${body}</main>
      <a class="fab" href="#/evento/nuovo">${I.plus}<span>Nuovo evento</span></a>
      ${nav('eventi')}`;
  }

  function viewEventForm(ev) {
    const isNew = !ev;
    const e = ev || { type: 'match', date: todayIso(), opponent: '', venue: 'home', notes: '' };
    return `<header class="hdr"><div class="hdr-row">
        <a class="icon-btn" href="#/eventi" aria-label="Chiudi senza salvare">${I.close}</a>
        <div class="hdr-main"><div class="hdr-title">${isNew ? 'Nuovo evento' : 'Modifica evento'}</div></div>
      </div></header>
      <form class="main" data-form="event" data-id="${isNew ? '' : esc(e.id)}" style="flex:1" id="evform" novalidate>
        <input type="hidden" name="type" value="${esc(e.type)}">
        <input type="hidden" name="venue" value="${esc(e.venue || 'home')}">
        <div class="field"><span class="flabel-t">Tipo</span>${seg('formType', [['match', 'Partita'], ['training', 'Allenamento']], e.type, 'Tipo evento')}</div>
        <div class="field"><label for="ev-date">Data</label><input class="input" id="ev-date" name="date" type="date" required value="${esc(e.date)}"></div>
        <div class="field match-only" ${e.type === 'training' ? 'hidden' : ''}><label for="ev-opp">Avversario</label><input class="input" id="ev-opp" name="opponent" type="text" autocomplete="off" placeholder="Nome squadra avversaria" value="${esc(e.opponent)}"></div>
        <div class="field match-only" ${e.type === 'training' ? 'hidden' : ''}><span class="flabel-t">Campo</span>${seg('formVenue', [['home', 'Casa'], ['away', 'Trasferta']], e.venue || 'home', 'Campo')}</div>
        <div class="field"><label for="ev-notes">Note (facoltative)</label><textarea class="input" id="ev-notes" name="notes" placeholder="Es. campionato, giornata, assenti…">${esc(e.notes)}</textarea></div>
        ${isNew ? '' : `<button type="button" class="btn btn-danger" data-act="deleteEvent" data-id="${esc(e.id)}">${I.trash}<span>Elimina evento</span></button>`}
      </form>
      <div class="form-footer">
        ${isNew
          ? `<button class="btn btn-primary" type="submit" form="evform" value="live">${I.play}<span>Crea e inizia rilevazione</span></button>
             <button class="btn" type="submit" form="evform" value="save">Salva per dopo</button>`
          : `<button class="btn btn-primary" type="submit" form="evform" value="save">Salva modifiche</button>`}
      </div>`;
  }

  /* ---------- Squadra ---------- */

  function viewSquadra() {
    const team = curTeam();
    const players = teamPlayers().sort(byNum);
    const rows = players.map(p => `<button class="prow ${p.active === false ? 'inactive' : ''}" data-act="editPlayer" data-id="${esc(p.id)}">
        <span class="badge ${p.role === 'L' ? 'lib' : ''}">${esc(p.num)}</span>
        <span class="pname">${esc(fullName(p))}${p.active === false ? ' · non attivo' : ''}</span>
        <span class="chip ${p.role === 'L' ? 'lib' : ''}">${esc(ROLE_NAME[p.role] || '—')}</span>
        ${I.chev}
      </button>`).join('');
    return `<header class="hdr"><div class="hdr-row">
        <div class="hdr-main">${teamPicker()}<h1>Squadra</h1></div>
        <button class="hdr-btn" data-act="openBackup">${I.download}<span>Backup</span></button>
      </div></header>
      <main class="main">
        <div class="field card" style="gap:6px">
          <label for="team-name">Nome squadra</label>
          <input class="input" id="team-name" data-bind="teamName" type="text" autocomplete="off" placeholder="Es. ASD Volley Valle" value="${esc(team.name)}">
          <button class="btn btn-sm" data-act="openTeams">${I.users}<span>${db.teams.length > 1 ? `Cambia squadra (${db.teams.length})` : 'Aggiungi un’altra squadra'}</span></button>
        </div>
        <div class="row-between">
          <h2 class="section-title">Giocatori · ${players.length}</h2>
          <button class="btn btn-primary btn-sm" data-act="newPlayer">${I.plus}<span>Aggiungi</span></button>
        </div>
        ${players.length ? `<div class="list">${rows}</div>` : `<div class="empty"><span>Nessun giocatore. Tocca “Aggiungi” per inserire la rosa.</span></div>`}
        ${db.teams.length > 1 ? `<button class="btn btn-danger" data-act="deleteTeam">${I.trash}<span>Elimina questa squadra</span></button>` : ''}
        <p class="legend" style="text-align:center;margin:8px 0 0">Scout Volley ${APP_VERSION}</p>
      </main>
      ${nav('squadra')}`;
  }

  function modalPlayer(id) {
    const p = id ? playerById(id) : null;
    const e = p || { num: '', last: '', first: '', role: 'S', active: true };
    const hasData = p && db.actions.some(a => a.pid === p.id);
    return `<form class="sheet" data-form="player" data-id="${p ? esc(p.id) : ''}" novalidate>
      <h2>${p ? 'Modifica giocatore' : 'Nuovo giocatore'}</h2>
      <div style="display:grid;grid-template-columns:96px 1fr;gap:10px">
        <div class="field"><label for="pl-num">Numero</label><input class="input" id="pl-num" name="num" type="number" inputmode="numeric" min="0" max="99" required value="${esc(e.num)}"></div>
        <div class="field"><label for="pl-last">Cognome</label><input class="input" id="pl-last" name="last" type="text" autocomplete="off" required value="${esc(e.last)}"></div>
      </div>
      <div class="field"><label for="pl-first">Nome (facoltativo)</label><input class="input" id="pl-first" name="first" type="text" autocomplete="off" value="${esc(e.first)}"></div>
      <div class="field"><label for="pl-role">Ruolo</label><select class="input" id="pl-role" name="role">${ROLES.map(([k, l]) => `<option value="${k}" ${e.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${p ? `<label style="display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600;min-height:44px"><input type="checkbox" name="active" ${e.active !== false ? 'checked' : ''} style="width:22px;height:22px"> Attivo (compare in formazione)</label>` : ''}
      <div class="btn-row">
        <button type="button" class="btn" data-act="closeModal">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
      ${p ? (hasData
        ? `<p>Questo giocatore ha dati registrati: per toglierlo dalla rosa disattivalo invece di eliminarlo.</p>`
        : `<button type="button" class="btn btn-danger" data-act="deletePlayer" data-id="${esc(p.id)}">${I.trash}<span>Elimina giocatore</span></button>`) : ''}
    </form>`;
  }

  function modalTeams() {
    const rows = db.teams.map(t => {
      const np = teamPlayers(t.id).length, ne = db.events.filter(e => e.teamId === t.id).length;
      const cur = t.id === curTeam().id;
      return `<button class="prow" data-act="pickTeam" data-id="${esc(t.id)}" aria-current="${cur}">
        <span class="pname">${esc(teamName(t))}<span class="psub">${np} giocatori · ${ne} eventi</span></span>
        ${cur ? `<span class="tick">${I.check}</span>` : I.chev}</button>`;
    }).join('');
    return `<div class="sheet">
      <div class="row-between"><h2>Squadre</h2><button class="icon-btn" data-act="closeModal" aria-label="Chiudi">${I.close}</button></div>
      <div class="list single">${rows}</div>
      <form class="field" data-form="team" novalidate>
        <label for="team-new">Nuova squadra</label>
        <div style="display:flex;gap:8px">
          <input class="input" id="team-new" name="name" type="text" autocomplete="off" placeholder="Es. Under 16">
          <button type="submit" class="btn btn-primary">${I.plus}<span>Crea</span></button>
        </div>
      </form>
      <p>Ogni squadra ha i suoi giocatori, eventi e statistiche.</p>
    </div>`;
  }

  function modalBackup() {
    const last = Number(localStorage.getItem(BACKUP_KEY) || 0);
    return `<div class="sheet">
      <h2>Backup dei dati</h2>
      <p>I dati di tutte le squadre sono salvati solo su questo telefono. Esporta un backup ogni tanto (ad esempio su WhatsApp o Google Drive): serve anche per passare i dati a un altro telefono.</p>
      <p>Ultimo backup: <strong>${last ? new Date(last).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : 'mai'}</strong></p>
      <button class="btn btn-primary" data-act="exportBackup">${I.download}<span>Esporta backup</span></button>
      <label class="btn" for="import-file">${I.upload}<span>Importa backup</span></label>
      <input id="import-file" class="sr-only" type="file" accept=".json,application/json" data-bind="importFile">
      <p>L’importazione sostituisce tutti i dati presenti su questo telefono.</p>
      <button class="btn" data-act="closeModal">Chiudi</button>
    </div>`;
  }

  /* ---------- Formazione ---------- */

  function ensureLineup(ev) {
    if (!Array.isArray(ev.court) || ev.court.length !== 6) {
      const c = Array.isArray(ev.court) ? ev.court.slice(0, 6) : [];
      while (c.length < 6) c.push(null);
      ev.court = c;
    }
    if (ev.liberoId === undefined) ev.liberoId = null;
    if (!ev.curSet) ev.curSet = 1;
  }
  const lineupEmpty = ev => !ev.court || ev.court.every(x => !x);

  function prefillLineup(ev) {
    // Copia la formazione dell'ultimo evento che ne ha una
    const prev = db.events
      .filter(e => e.id !== ev.id && e.teamId === ev.teamId && e.court && e.court.some(Boolean))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!prev) return;
    const ok = id => { const p = playerById(id); return p && p.active !== false; };
    ev.court = prev.court.map(id => ok(id) ? id : null);
    ev.liberoId = ok(prev.liberoId) ? prev.liberoId : null;
  }

  function viewLineup(ev) {
    ensureLineup(ev);
    const players = activePlayers(ev.teamId);
    const n = ev.court.filter(Boolean).length;
    const tiles = players.map(p => {
      const on = ev.court.includes(p.id), lib = ev.liberoId === p.id;
      return `<button class="lu-tile ${on ? 'on' : ''} ${lib ? 'libon' : ''}" data-act="luToggle" data-id="${esc(p.id)}" aria-pressed="${on || lib}">
        <span class="n">${esc(p.num)}</span><span class="t">${esc(p.last)}${lib ? ' (L)' : ''}</span></button>`;
    }).join('');
    return `<header class="hdr"><div class="hdr-row">
        <a class="icon-btn" href="#/eventi" aria-label="Torna agli eventi">${I.back}</a>
        <div class="hdr-main"><div class="hdr-title">Formazione</div><div class="hdr-sub">${esc(evTitle(ev))} · ${esc(fmtDate(ev.date).long)}</div></div>
      </div></header>
      <main class="main">
        ${players.length ? `
        <p class="legend" style="margin:0">Tocca i 6 giocatori in campo. Toccando un libero lo imposti come libero. I giocatori non selezionati vanno in panchina.</p>
        <div class="row-between"><h2 class="section-title">In campo ${n}/6 · Libero: ${ev.liberoId ? esc(P(ev.liberoId).last) : 'nessuno'}</h2>
        <button class="btn btn-sm" data-act="luClear">Svuota</button></div>
        <div class="lineup-grid">${tiles}</div>` : `<div class="empty"><strong>Nessun giocatore</strong><span>Prima inserisci la rosa nella sezione Squadra.</span><a class="btn btn-primary" href="#/squadra">Vai a Squadra</a></div>`}
      </main>
      <div class="form-footer">
        <button class="btn btn-primary" data-act="luDone" ${n ? '' : 'disabled'}>${I.play}<span>Vai alla rilevazione</span></button>
      </div>`;
  }

  /* ---------- Rilevazione live ---------- */

  function viewLive(ev) {
    ensureLineup(ev);
    const L = ui.live;
    const set = ev.curSet;
    const acts = actionsOf(ev.id).filter(a => a.set === set);
    const tile = (pid, slot, extra) => {
      if (!pid) {
        return `<button class="tile empty ${L.subMode ? 'target' : ''}" data-act="liveSlot" data-slot="${slot}" ${L.subMode ? '' : 'aria-disabled="true"'}>
          <span class="t">${slot === 'L' ? 'Nessun libero' : 'Vuoto'}</span></button>`;
      }
      const p = P(pid);
      const cls = [extra, L.subMode ? 'target' : '', (L.sel === pid) ? 'sel' : ''].join(' ');
      return `<button class="tile ${cls}" data-act="liveSlot" data-slot="${slot}"><span class="n">${esc(p.num)}</span><span class="t">${esc(p.last)}${slot === 'L' && p.role === 'L' ? ' (L)' : ''}</span></button>`;
    };

    let hint, hintCls = '';
    if (L.msg) { hint = L.msg; hintCls = L.msgKind; }
    else if (L.subMode) hint = L.subIn ? 'Ora tocca chi esce' : 'Tocca chi entra dalla panchina';
    else if (L.sel) {
      const p = P(L.sel);
      hint = isLibero(L.sel) ? `${p.num} ${p.last} · solo ricezione` : `${p.num} ${p.last} → scegli l’esito`;
      hintCls = 'sel';
    } else hint = 'Tocca un giocatore, poi l’esito';

    const enabled = f => !!L.sel && !L.subMode && (!isLibero(L.sel) || f.key === 'R');
    const outcomes = FUNDS.map(f => {
      const en = enabled(f);
      return `<div class="frow ${en ? '' : 'off'}"><span class="flabel">${f.label}</span><div class="fbtns">${f.out.map(([code, kind, span]) =>
        `<button class="ob k-${kind} ${span === 2 ? 'span2' : ''}" data-act="press" data-f="${f.key}" data-code="${esc(code)}" aria-disabled="${!en}" aria-label="${f.label} ${esc(code)}">${esc(code)}</button>`).join('')}</div></div>`;
    }).join('');

    const onField = new Set([...ev.court, ev.liberoId].filter(Boolean));
    const bench = activePlayers(ev.teamId).filter(p => !onField.has(p.id));
    const benchHtml = `<div class="benchpanel">
        <div class="sec-label">Panchina</div>
        ${bench.length ? `<div class="bench">${bench.map(p =>
          `<button class="tile ${L.subIn === p.id ? 'sel' : ''} ${p.role === 'L' ? 'lib' : ''}" data-act="benchPick" data-id="${esc(p.id)}"><span class="n">${esc(p.num)}</span><span class="t">${esc(p.last)}</span></button>`).join('')}</div>`
          : '<div class="legend">Nessun giocatore in panchina.</div>'}
        <button class="btn" data-act="toggleSub">Chiudi cambio</button>
      </div>`;

    const recent = acts.slice(-4).reverse().map(a =>
      `<span class="rchip k-${KIND[a.f + a.code] || 'mid'}">${esc(P(a.pid).num)} ${FUND[a.f].short} ${esc(a.code)}</span>`).join('');

    return `<header class="hdr">
        <div class="hdr-row">
          <a class="icon-btn" href="#/eventi" aria-label="Torna agli eventi">${I.back}</a>
          <div class="hdr-main"><div class="hdr-title">${esc(evTitle(ev))}</div><div class="hdr-sub">${esc(evSub(ev))}</div></div>
          <button class="icon-btn" data-act="openLog" aria-label="Registro azioni">${I.list}</button>
          <a class="icon-btn" href="#/evento/${ev.id}/formazione" aria-label="Modifica formazione">${I.users}</a>
        </div>
        <div class="live-sets"><span>Set</span>
          ${[1, 2, 3, 4, 5].map(n => `<button data-act="setSet" data-v="${n}" aria-pressed="${n === set}" aria-label="Set ${n}">${n}</button>`).join('')}
          <div class="live-count"><div class="v">${acts.length}</div><div class="l">azioni</div></div>
        </div>
      </header>
      <div class="live-body">
        <div class="live-players">
        <div class="row-between">
          <span class="sec-label">${L.subMode ? 'Cambio' : 'In campo'}</span>
          <button class="btn btn-sm" data-act="toggleSub" aria-pressed="${L.subMode}">${I.swap}<span>${L.subMode ? 'Chiudi' : 'Cambio'}</span></button>
        </div>
        <div class="court">${ev.court.map((pid, i) => tile(pid, i, '')).join('')}</div>
        <div class="row2">
          ${tile(ev.liberoId, 'L', 'lib')}
          <div class="hint ${hintCls}" role="status">${esc(hint)}</div>
        </div>
        </div>
        ${L.subMode ? benchHtml : `<div class="outcomes">${outcomes}</div>`}
      </div>
      <div class="recentbar">
        <div class="recent">${recent || '<span class="none">Nessuna azione in questo set</span>'}</div>
        <button class="btn btn-sm" data-act="undo" ${acts.length ? '' : 'disabled'}>${I.undo}<span>Annulla</span></button>
      </div>`;
  }

  function modalLog(ev, set) {
    const acts = actionsOf(ev.id).filter(a => a.set === set);
    const rows = acts.map((a, i) => ({ a, i })).reverse().map(({ a, i }) => {
      const p = P(a.pid);
      return `<div class="logrow"><span class="i">${i + 1}</span>
        <span class="who">${esc(p.num)} ${esc(p.last)}</span>
        <span class="rchip k-${KIND[a.f + a.code] || 'mid'}">${FUND[a.f].short} ${esc(a.code)}</span>
        <button class="icon-btn" data-act="delAction" data-id="${esc(a.id)}" aria-label="Elimina azione ${i + 1}">${I.trash}</button></div>`;
    }).join('');
    return `<div class="sheet">
      <div class="row-between"><h2>Registro azioni</h2><button class="icon-btn" data-act="closeModal" aria-label="Chiudi">${I.close}</button></div>
      <div class="setchips">${[1, 2, 3, 4, 5].map(n => `<button data-act="logSet" data-v="${n}" aria-pressed="${n === set}">Set ${n}</button>`).join('')}</div>
      ${acts.length ? `<div class="loglist">${rows}</div>` : '<p>Nessuna azione in questo set.</p>'}
      <p>Per correggere un’azione eliminala e inseriscila di nuovo.</p>
    </div>`;
  }

  /* ---------- Statistiche ---------- */

  function aggregate(acts) {
    const by = {};
    for (const a of acts) {
      const f = FUND[a.f];
      if (!f) continue;
      const idx = f.out.findIndex(o => o[0] === a.code);
      if (idx < 0) continue;
      const r = by[a.pid] || (by[a.pid] = { B: [0, 0, 0, 0], R: [0, 0, 0], A: [0, 0, 0, 0], M: [0] });
      r[a.f][idx]++;
    }
    return by;
  }
  function teamTotals(by) {
    const t = { B: [0, 0, 0, 0], R: [0, 0, 0], A: [0, 0, 0, 0], M: [0] };
    Object.values(by).forEach(r => FUNDS.forEach(f => r[f.key].forEach((v, i) => { t[f.key][i] += v; })));
    return t;
  }
  function statSelection(evParam) {
    const S = ui.stat;
    let ev = null;
    if (evParam && evParam !== 'all') ev = eventById(evParam);
    let acts;
    if (ev) {
      acts = actionsOf(ev.id);
      if (S.set) acts = acts.filter(a => a.set === S.set);
    } else {
      const ids = new Set(teamEvents().filter(e => S.type === 'all' || (S.type === 'match' ? e.type !== 'training' : e.type === 'training')).map(e => e.id));
      acts = db.actions.filter(a => ids.has(a.eventId));
    }
    return { ev, acts };
  }

  function viewStat(evParam) {
    if (!evParam) {
      const withData = teamEvents().filter(e => db.actions.some(a => a.eventId === e.id)).sort((a, b) => b.date.localeCompare(a.date))[0];
      evParam = withData ? withData.id : 'all';
    }
    const S = ui.stat;
    const { ev, acts } = statSelection(evParam);
    const by = aggregate(acts);
    const t = teamTotals(by);
    const punti = t.B[0] + t.A[0] + t.M[0];
    const errori = t.B[3] + t.R[2] + t.A[2] + t.A[3];
    const kpis = [
      [punti, 'Punti fatti', 'ok'],
      [errori, 'Errori', 'err'],
      [pct(METRIC.A.calc(t.A), sum(t.A)), 'Eff. attacco', ''],
      [pct(METRIC.R.calc(t.R), sum(t.R)), 'Pos. ricezione', '']
    ];
    const f = FUND[S.tab], m = METRIC[S.tab];
    const head = S.tab === 'M'
      ? '<th>Giocatore</th><th>Muri #</th>'
      : `<th>Giocatore</th><th>Tot</th>${f.out.map(o => `<th>${esc(o[0])}</th>`).join('')}<th>${m.label}</th>`;
    const row = (name, v, cls) => {
      const tot = sum(v);
      if (S.tab === 'M') return `<tr class="${cls}"><td>${esc(name)}</td><td>${tot}</td></tr>`;
      const n = m.calc(v);
      return `<tr class="${cls}"><td>${esc(name)}</td><td>${tot}</td>${v.map(x => `<td>${x}</td>`).join('')}<td class="pct ${n < 0 ? 'neg' : ''}">${pct(n, tot)}</td></tr>`;
    };
    const pids = Object.keys(by).filter(id => sum(by[id][S.tab]) > 0).sort((a, b) => byNum(P(a), P(b)));
    const rows = pids.map(id => row(`${P(id).num} ${P(id).last}`, by[id][S.tab], '')).join('');
    const maxSet = ev ? Math.max(0, ...actionsOf(ev.id).map(a => a.set)) : 0;
    const evList = teamEvents();
    if (ev && !evList.includes(ev)) evList.push(ev);
    const evOptions = evList.sort((a, b) => b.date.localeCompare(a.date))
      .map(e => `<option value="${esc(e.id)}" ${ev && ev.id === e.id ? 'selected' : ''}>${esc(fmtDate(e.date).d + ' ' + fmtDate(e.date).m)} · ${esc(evTitle(e))}</option>`).join('');

    return `<header class="hdr"><div class="hdr-row">
        <div class="hdr-main">${teamPicker()}<h1>Statistiche</h1></div>
      </div></header>
      <main class="main">
        <div class="field">
          <label for="stat-ev">Evento</label>
          <select class="input" id="stat-ev" data-bind="statEvent">
            <option value="all" ${ev ? '' : 'selected'}>Tutti gli eventi</option>
            ${evOptions}
          </select>
        </div>
        ${ev
          ? (maxSet > 1 ? `<div class="setchips" role="group" aria-label="Set">${[0, ...Array.from({ length: maxSet }, (_, i) => i + 1)].map(n =>
              `<button data-act="statSet" data-v="${n}" aria-pressed="${S.set === n}">${n ? 'Set ' + n : 'Tutti'}</button>`).join('')}</div>` : '')
          : seg('statType', [['all', 'Tutti'], ['match', 'Partite'], ['training', 'Allenamenti']], S.type, 'Tipo eventi')}
        ${acts.length ? `
        <div class="kpis">${kpis.map(([v, l, c]) => `<div class="kpi"><span class="v ${c}">${v}</span><span class="l">${l}</span></div>`).join('')}</div>
        <div class="tabs" role="tablist" aria-label="Fondamentale">${FUNDS.map(x =>
          `<button role="tab" data-act="statTab" data-v="${x.key}" aria-selected="${S.tab === x.key}">${x.key === 'R' ? 'Ricez.' : x.label}</button>`).join('')}</div>
        <div class="table"><table><thead><tr>${head}</tr></thead><tbody>
          ${rows || `<tr><td colspan="7" style="text-align:left;color:#4A5160">Nessun dato per questo fondamentale.</td></tr>`}
          ${rows ? row('Squadra', t[S.tab], 'total') : ''}
        </tbody></table></div>
        <div class="legend">${m ? m.note + '<br>' : ''}Punti fatti = battuta # + attacco # + muro #<br>Errori = battuta = + ricezione /= + attacco / e =</div>
        <button class="btn btn-primary" data-act="exportCsv" data-ev="${ev ? esc(ev.id) : 'all'}">${I.download}<span>Esporta / condividi CSV</span></button>`
        : `<div class="empty"><strong>Nessun dato</strong><span>Le statistiche compaiono dopo la prima rilevazione.</span></div>`}
      </main>
      ${nav('stat')}`;
  }

  function buildCsv(evParam) {
    const { ev, acts } = statSelection(evParam);
    const by = aggregate(acts);
    const t = teamTotals(by);
    const head = ['Numero', 'Cognome', 'Nome',
      'Bat tot', 'Bat #', 'Bat +', 'Bat -', 'Bat =', 'Bat eff%',
      'Ric tot', 'Ric #+', 'Ric -', 'Ric /=', 'Ric pos%',
      'Att tot', 'Att #', 'Att +-', 'Att /', 'Att =', 'Att eff%',
      'Muro #', 'Punti'];
    const pctNum = (n, tot) => tot ? Math.round(n / tot * 100) : '';
    const line = (num, last, first, r) => [num, last, first,
      sum(r.B), ...r.B, pctNum(METRIC.B.calc(r.B), sum(r.B)),
      sum(r.R), ...r.R, pctNum(METRIC.R.calc(r.R), sum(r.R)),
      sum(r.A), ...r.A, pctNum(METRIC.A.calc(r.A), sum(r.A)),
      r.M[0], r.B[0] + r.A[0] + r.M[0]];
    const rows = Object.keys(by).sort((a, b) => byNum(P(a), P(b))).map(id => { const p = P(id); return line(p.num, p.last, p.first, by[id]); });
    rows.push(line('', 'Squadra', '', t));
    const cell = v => { const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const title = ev ? `${evTitle(ev)} - ${fmtDate(ev.date).long}${ui.stat.set ? ' - set ' + ui.stat.set : ''}` : 'Tutti gli eventi';
    const csv = '﻿' + [[teamName(ev ? db.teams.find(t => t.id === ev.teamId) : curTeam()), title], head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
    const name = 'scout_' + (ev ? ev.date + '_' + slug(evTitle(ev)) : 'tutti_' + todayIso()) + '.csv';
    return { csv, name };
  }

  /* ---------- Render ---------- */

  const app = document.getElementById('app');

  function render() {
    const r = route();
    const key = r.join('/');
    const oldMain = app.querySelector('.main');
    const keepScroll = key === lastKey && oldMain ? oldMain.scrollTop : 0;
    let html;
    let live = false;
    if (r[0] === 'squadra') html = viewSquadra();
    else if (r[0] === 'stat') html = viewStat(r[1]);
    else if (r[0] === 'evento' && r[1] === 'nuovo') html = viewEventForm(null);
    else if (r[0] === 'evento' && r[1]) {
      const ev = eventById(r[1]);
      if (!ev) html = `<header class="hdr"><h1>Evento non trovato</h1></header><main class="main"><a class="btn" href="#/eventi">Torna agli eventi</a></main>`;
      else if (r[2] === 'modifica') html = viewEventForm(ev);
      else if (r[2] === 'formazione') html = viewLineup(ev);
      else {
        ensureLineup(ev);
        if (lineupEmpty(ev)) { go(`#/evento/${ev.id}/formazione`); return; }
        if (ui.live.evId !== ev.id) ui.live = { evId: ev.id, sel: null, msg: null, msgKind: '', subMode: false, subIn: null };
        html = viewLive(ev);
        live = true;
      }
    } else html = viewEventi();

    let modal = '';
    if (ui.modal) {
      let inner = '';
      if (ui.modal.type === 'player') inner = modalPlayer(ui.modal.id);
      else if (ui.modal.type === 'teams') inner = modalTeams();
      else if (ui.modal.type === 'backup') inner = modalBackup();
      else if (ui.modal.type === 'log') { const ev = eventById(ui.modal.evId); if (ev) inner = modalLog(ev, ui.modal.set); }
      if (inner) modal = `<div class="overlay" data-act="overlay">${inner}</div>`;
    }
    app.innerHTML = html + modal;
    if (keepScroll) { const m = app.querySelector('.main'); if (m) m.scrollTop = keepScroll; }
    lastKey = key;
    keepAwake(live);
  }

  /* ---------- Azioni ---------- */

  function liveMsg(msg, kind) { ui.live.msg = msg; ui.live.msgKind = kind || ''; }
  function armSel() {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      ui.live.sel = null; ui.live.msg = null;
      const r = route();
      if (r[0] === 'evento' && r[2] === 'live' && !ui.modal) render();
    }, SEL_TIMEOUT);
  }
  const currentEvent = () => eventById(route()[1]);

  const actions = {
    evFilter(d) { ui.evFilter = d.v; render(); },
    formType(d, el) {
      const form = document.getElementById('evform');
      form.elements.type.value = d.v;
      el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
      form.querySelectorAll('.match-only').forEach(x => { x.hidden = d.v === 'training'; });
    },
    formVenue(d, el) {
      document.getElementById('evform').elements.venue.value = d.v;
      el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
    },
    deleteEvent(d) {
      const ev = eventById(d.id);
      if (!ev) return;
      const n = actionsOf(ev.id).length;
      if (!confirm(`Eliminare “${evTitle(ev)}”${n ? ` e le sue ${n} azioni` : ''}? L’operazione non si può annullare.`)) return;
      db.events = db.events.filter(e => e.id !== ev.id);
      db.actions = db.actions.filter(a => a.eventId !== ev.id);
      save();
      toast('Evento eliminato');
      go('#/eventi');
    },
    newPlayer() { ui.modal = { type: 'player', id: null }; render(); focusFirst(); },
    editPlayer(d) { ui.modal = { type: 'player', id: d.id }; render(); },
    deletePlayer(d) {
      const p = playerById(d.id);
      if (!p || !confirm(`Eliminare ${fullName(p)}?`)) return;
      db.players = db.players.filter(x => x.id !== p.id);
      db.events.forEach(e => {
        if (Array.isArray(e.court)) e.court = e.court.map(id => id === p.id ? null : id);
        if (e.liberoId === p.id) e.liberoId = null;
      });
      save();
      ui.modal = null;
      render();
    },
    openBackup() { ui.modal = { type: 'backup' }; render(); },
    openTeams() { ui.modal = { type: 'teams' }; render(); },
    pickTeam(d) {
      db.curTeamId = d.id;
      save();
      ui.modal = null;
      ui.stat.set = 0;
      toast('Squadra: ' + teamName(curTeam()));
      if (route()[0] === 'stat' && route()[1]) go('#/stat'); else render();
    },
    deleteTeam() {
      const t = curTeam();
      if (db.teams.length < 2) return;
      const evIds = new Set(db.events.filter(e => e.teamId === t.id).map(e => e.id));
      const np = teamPlayers(t.id).length;
      if (!confirm(`Eliminare la squadra “${teamName(t)}” con ${np} giocatori e ${evIds.size} eventi? L’operazione non si può annullare.`)) return;
      db.teams = db.teams.filter(x => x.id !== t.id);
      db.players = db.players.filter(p => p.teamId !== t.id);
      db.events = db.events.filter(e => e.teamId !== t.id);
      db.actions = db.actions.filter(a => !evIds.has(a.eventId));
      db.curTeamId = db.teams[0].id;
      save();
      toast('Squadra eliminata');
      render();
    },
    closeModal() { ui.modal = null; render(); },
    overlay(d, el, e) { if (e.target === el) { ui.modal = null; render(); } },
    async exportBackup() {
      const data = JSON.stringify(Object.assign({ app: 'scout-volley', exportedAt: new Date().toISOString() }, db));
      const ok = await shareOrDownload(`scout-volley-backup_${todayIso()}.json`, 'application/json', data);
      if (ok) { localStorage.setItem(BACKUP_KEY, String(Date.now())); toast('Backup esportato'); render(); }
    },

    luToggle(d) {
      const ev = currentEvent();
      ensureLineup(ev);
      const p = playerById(d.id);
      const i = ev.court.indexOf(d.id);
      if (i >= 0) ev.court[i] = null;
      else if (ev.liberoId === d.id) ev.liberoId = null;
      else if (p.role === 'L') ev.liberoId = d.id;
      else {
        const free = ev.court.indexOf(null);
        if (free < 0) { toast('Ci sono già 6 giocatori in campo'); return; }
        ev.court[free] = d.id;
      }
      save();
      render();
    },
    luClear() { const ev = currentEvent(); ev.court = [null, null, null, null, null, null]; ev.liberoId = null; save(); render(); },
    luDone() { go(`#/evento/${route()[1]}/live`); },

    setSet(d) {
      const ev = currentEvent();
      ev.curSet = Number(d.v);
      save();
      clearTimeout(selTimer);
      ui.live.sel = null;
      liveMsg(null);
      render();
    },
    liveSlot(d) {
      const ev = currentEvent();
      const L = ui.live;
      const slot = d.slot;
      const pid = slot === 'L' ? ev.liberoId : ev.court[Number(slot)];
      clearTimeout(selTimer);
      if (L.subMode) {
        if (!L.subIn) { liveMsg('Prima tocca chi entra', 'err'); render(); return; }
        const inP = P(L.subIn);
        if (slot === 'L') ev.liberoId = L.subIn; else ev.court[Number(slot)] = L.subIn;
        save();
        liveMsg(pid ? `Entra ${inP.num} ${inP.last}, esce ${P(pid).num} ${P(pid).last}` : `Entra ${inP.num} ${inP.last}`, 'ok');
        L.subMode = false; L.subIn = null; L.sel = null;
        buzz(25);
        render();
        return;
      }
      if (!pid) return;
      L.sel = L.sel === pid ? null : pid;
      liveMsg(null);
      render();
    },
    benchPick(d) { const L = ui.live; L.subIn = L.subIn === d.id ? null : d.id; liveMsg(null); render(); },
    toggleSub() {
      const L = ui.live;
      clearTimeout(selTimer);
      L.subMode = !L.subMode; L.subIn = null; L.sel = null;
      liveMsg(null);
      render();
    },
    press(d) {
      const ev = currentEvent();
      const L = ui.live;
      if (L.subMode) return;
      if (!L.sel) { liveMsg('Prima tocca il giocatore', 'err'); buzz([15, 40, 15]); render(); return; }
      if (isLibero(L.sel) && d.f !== 'R') { liveMsg('Il libero può solo ricevere', 'err'); buzz([15, 40, 15]); render(); return; }
      db.actions.push({ id: uid(), eventId: ev.id, set: ev.curSet, pid: L.sel, f: d.f, code: d.code, t: Date.now() });
      save();
      buzz(25);
      const p = P(L.sel);
      liveMsg(`✓ ${p.num} ${p.last} · ${FUND[d.f].short} ${d.code}`, 'ok');
      render();
      armSel();
    },
    undo() {
      const ev = currentEvent();
      for (let i = db.actions.length - 1; i >= 0; i--) {
        const a = db.actions[i];
        if (a.eventId === ev.id && a.set === ev.curSet) {
          db.actions.splice(i, 1);
          save();
          buzz(15);
          clearTimeout(selTimer);
          ui.live.sel = null;
          liveMsg(`Annullato: ${P(a.pid).num} ${FUND[a.f].short} ${a.code}`, '');
          render();
          return;
        }
      }
    },
    openLog() { const ev = currentEvent(); clearTimeout(selTimer); ui.modal = { type: 'log', evId: ev.id, set: ev.curSet }; render(); },
    logSet(d) { ui.modal.set = Number(d.v); render(); },
    delAction(d) {
      if (!confirm('Eliminare questa azione?')) return;
      db.actions = db.actions.filter(a => a.id !== d.id);
      save();
      render();
    },

    statSet(d) { ui.stat.set = Number(d.v); render(); },
    statType(d) { ui.stat.type = d.v; render(); },
    statTab(d) { ui.stat.tab = d.v; render(); },
    async exportCsv(d) {
      const { csv, name } = buildCsv(d.ev);
      if (await shareOrDownload(name, 'text/csv', csv)) toast('CSV pronto');
    }
  };

  function focusFirst() {
    const el = app.querySelector('.sheet input:not([type=hidden])');
    if (el) el.focus();
  }

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || !app.contains(el)) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.dataset.act === 'overlay') { fn(el.dataset, el, e); return; }
    if (el.disabled) return;
    e.preventDefault();
    fn(el.dataset, el, e);
  });

  app.addEventListener('change', e => {
    const el = e.target;
    const bind = el.dataset && el.dataset.bind;
    if (bind === 'teamName') {
      curTeam().name = el.value.trim();
      save();
      toast('Nome squadra salvato');
    } else if (bind === 'statEvent') {
      ui.stat.set = 0;
      go('#/stat/' + el.value);
    } else if (bind === 'importFile' && el.files && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        let data;
        try { data = JSON.parse(reader.result); } catch (err) { toast('File non valido'); return; }
        if (!data || !Array.isArray(data.players) || !Array.isArray(data.events) || !Array.isArray(data.actions)) {
          toast('Questo file non è un backup di Scout Volley');
          return;
        }
        const nt = Array.isArray(data.teams) ? data.teams.length : 1;
        const msg = `Importare il backup (${nt === 1 ? '1 squadra' : nt + ' squadre'}, ${data.players.length} giocatori, ${data.events.length} eventi, ${data.actions.length} azioni)? I dati attuali verranno sostituiti.`;
        if (!confirm(msg)) return;
        db = normalize(data);
        save();
        ui.modal = null;
        toast('Backup importato');
        go('#/eventi');
        render();
      };
      reader.readAsText(el.files[0]);
    }
  });

  app.addEventListener('submit', e => {
    const form = e.target;
    e.preventDefault();
    if (form.dataset.form === 'event') {
      const f = form.elements;
      const type = f.type.value;
      const date = f.date.value;
      if (!date) { toast('Inserisci la data'); f.date.focus(); return; }
      const data = {
        type, date,
        opponent: type === 'training' ? '' : f.opponent.value.trim(),
        venue: f.venue.value,
        notes: f.notes.value.trim()
      };
      let ev = form.dataset.id ? eventById(form.dataset.id) : null;
      if (ev) Object.assign(ev, data);
      else {
        ev = Object.assign({ id: uid(), teamId: curTeam().id, createdAt: Date.now(), curSet: 1 }, data);
        ensureLineup(ev);
        prefillLineup(ev);
        db.events.push(ev);
      }
      save();
      const submitter = e.submitter;
      if (submitter && submitter.value === 'live') go(`#/evento/${ev.id}/formazione`);
      else { toast('Evento salvato'); go('#/eventi'); }
    } else if (form.dataset.form === 'player') {
      const f = form.elements;
      const num = String(f.num.value).trim();
      const last = f.last.value.trim();
      if (num === '' || !last) { toast('Numero e cognome sono obbligatori'); return; }
      const id = form.dataset.id;
      const active = f.active ? f.active.checked : true;
      const tid = id ? playerById(id).teamId : curTeam().id;
      const dup = teamPlayers(tid).find(p => p.id !== id && p.active !== false && String(p.num) === num);
      if (dup && active) { toast(`Il numero ${num} è già di ${dup.last}`); return; }
      const data = { num: Number(num), last, first: f.first.value.trim(), role: f.role.value, active };
      if (id) Object.assign(playerById(id), data);
      else db.players.push(Object.assign({ id: uid(), teamId: tid }, data));
      save();
      ui.modal = null;
      render();
      toast('Giocatore salvato');
    } else if (form.dataset.form === 'team') {
      const name = form.elements.name.value.trim();
      if (!name) { toast('Scrivi il nome della squadra'); form.elements.name.focus(); return; }
      const t = { id: uid(), name };
      db.teams.push(t);
      db.curTeamId = t.id;
      save();
      ui.modal = null;
      toast('Squadra creata: ora inserisci i giocatori');
      if (route()[0] === 'squadra') render(); else go('#/squadra');
    }
  });

  window.addEventListener('hashchange', () => { ui.modal = null; render(); });

  /* ---------- Schermo acceso, offline, memoria persistente ---------- */

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        const w = wakeLock;
        wakeLock = null;
        await w.release();
      }
    } catch (e) { /* non supportato o negato */ }
  }
  document.addEventListener('visibilitychange', () => {
    const r = route();
    if (document.visibilityState === 'visible' && r[0] === 'evento' && r[2] === 'live') keepAwake(true);
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Quando una nuova versione prende il controllo, ricarica una volta per usarla subito.
    // I dati sono già salvati, quindi non si perde nulla.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(reg => reg.update())
        .catch(() => {});
    });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // L'app installata può conservare il vecchio blocco in verticale del manifest
  // (Chrome lo aggiorna con ritardo): sblocca la rotazione all'avvio.
  try {
    if (screen.orientation && screen.orientation.lock && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) {
      screen.orientation.lock('any').catch(() => {});
    }
  } catch (e) { /* non supportato */ }

  render();
})();
