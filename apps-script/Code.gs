/**
 * Darčeky pre organizátorov: server v Google Apps Scripte.
 *
 * Dáta sú v Google tabuľke, ku ktorej je skript pripojený:
 *   hárok „Darčeky“            jeden riadok = jeden darček
 *   hárok „Noví organizátori“  organizátori, ktorí nie sú v retieringu (pridané v aplikácii)
 *   hárok „Tím“                id | meno | aktivny | email   (email = adresa zo stĺpca „Responsible new“ v retieringu,
 *                               viac adries oddeľ čiarkou; podľa nej sa skladá portfólio KAM)
 *
 * Klienti a tiery sa čítajú priamo z Google tabuľky „PLG CZ – retiering – source“ (hárok Source):
 *   Promoter, VAT number, Platform, Responsible new, Final tier, GMV CZK.
 * Retiering sa len číta, nikdy sa doň nezapisuje. Načítaný zoznam si server pamätá 15 minút.
 *
 * Kto čo smie: člen tímu pridáva darčeky a upravuje či maže len tie, ktoré sám zapísal.
 * Správca (prihlásený heslom ADMIN_PASSWORD) môže meniť všetky. Stráži to server, nie stránka.
 * Postup nasadenia je v README.md v repozitári.
 */

// Nastavenie. SPREADSHEET_ID určuje tabuľku s dátami, skript tak funguje pripojený k nej aj samostatne.
const SPREADSHEET_ID = '1iHvdCp_OD55wpYS-ikFBnPlQEDe_dD3-AidkOBLg398';   // tabuľka „Darčeky pre organizátorov – dáta“; prázdne = tabuľka, ku ktorej je skript pripojený
const DEFAULT_TEAM_KEY = ''; // tímový kľúč, ak ho nevytváraš funkciou vytvorTimovyKluc

// Zdroj tierov a portfólií.
const RETIER_ID = '1s6FsTzRG3dlxi9Md27-wfHs_e7NeGUPEnQJftfzkgV4';
const RETIER_SHEET = 'Source';
const RETIER_COLS = {name: 'Promoter', vat: 'VAT number', platform: 'Platform', owner: 'Responsible new', tier: 'Final tier', gmv: 'GMV CZK'};
const CACHE_SECONDS = 900;

const VERSION = 1; // zvýš pri každej zmene kódu, stránka podľa toho pozná, čo beží

const SHEET = 'Darčeky';
const ORG_SHEET = 'Noví organizátori';
const TEAM_SHEET = 'Tím';
const HEAD = ['id', 'organizator', 'ico', 'tier', 'kam', 'dovod', 'pocet', 'stav', 'termin', 'poznamka',
  'zapisal', 'zapisane', 'upravil', 'upravene', 'klient', 'vlastnik'];
const ORG_HEAD = ['id', 'organizator', 'ico', 'tier', 'kam', 'pridal', 'pridane'];
const TEAM_HEAD = ['id', 'meno', 'aktivny', 'email'];
const C = {}; HEAD.forEach(function (h, i) { C[h] = i + 1; });
const ID_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const ADMIN_ID = '_admin';
const MAX_ROWS = 5000;

// Prvé naplnenie hárku „Tím“, ak je prázdny. Potom sa tím upravuje priamo v tabuľke.
const DEFAULT_TEAM = [
  ['janci', 'Janči', true, 'jan.kamenicky@ticketportal.cz'],
  ['kamca', 'Kamča', true, 'kudejova@goout.net'],
  ['jakub', 'Jakub', true, 'dvorny@goout.net'],
  ['filip', 'Filip', true, 'filip.nemec@ticketportal.cz'],
  ['jirka', 'Jirka', true, 'jiri.mandak@ticketportal.cz'],
  ['andrej', 'Andrej', true, 'andrej.brabec@ticketstream.cz'],
  ['roman', 'Roman', true, 'roman.knezu@ticketstream.cz, knezu@goout.net'],
  ['tomas-h', 'Tomáš H.', true, 'tomas.heinzel@ticketportal.cz'],
  ['martin', 'Martin', true, 'martin.gremlica@ticketportal.cz'],
  ['bara', 'Bára', true, 'prokopova@goout.net'],
  ['lucia', 'Lucia', true, 'lucia@ticketportal.cz']
];

// Kód v aplikácii → text v tabuľke.
const TIER = {lite: 'LITE', profi: 'PROFI', premium: 'PREMIUM'};
const DOVOD = {improvement: 'Business improvement', stable: 'Business stable', fix: 'Business fix'};
const STAV = {navrhnute: 'Navrhnuté', schvalene: 'Schválené', objednane: 'Objednané', odovzdane: 'Odovzdané'};

/* ---------- webová aplikácia ---------- */

function doGet() {
  return out_({ok: true, data: {info: 'Darčeky pre organizátorov: server beží, verzia ' + VERSION + '.', verzia: VERSION}});
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return out_({ok: false, error: 'bad_request'});
  }
  const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY') || DEFAULT_TEAM_KEY;
  if (!key) return out_({ok: false, error: 'not_configured'});
  if (!req || req.key !== key) return out_({ok: false, error: 'unauthorized'});
  try {
    switch (req.action) {
      case 'team':
        return out_({ok: true, data: readTeam_()});
      case 'list':
        return out_({ok: true, data: listFor_(req)});
      case 'clients':
        return out_({ok: true, data: {v: VERSION, clients: readClients_(req.refresh === true && isAdmin_(req))}});
      case 'add':
        return out_({ok: true, data: withLock_(function () { addItem_(req.item, req.org, req); return listFor_(req); })});
      case 'update':
        return out_({ok: true, data: withLock_(function () { updateItem_(req.id, req.item, req); return listFor_(req); })});
      case 'delete':
        return out_({ok: true, data: withLock_(function () { deleteItem_(req.id, req); return listFor_(req); })});
      default:
        return out_({ok: false, error: 'bad_request'});
    }
  } catch (err) {
    const code = err && err.code ? err.code : 'server_error';
    if (code === 'server_error') console.error(err);
    return out_({ok: false, error: code, message: String(err && err.message ? err.message : '')});
  }
}

/**
 * Vytvorí nový tímový kľúč a vypíše ho do protokolu spustenia.
 * Spusti raz pri nasadení. Opakovaným spustením starý kľúč zneplatníš.
 */
function vytvorTimovyKluc() {
  const k = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('TEAM_KEY', k);
  Logger.log('Tímový kľúč: ' + k);
  Logger.log('Vlož ho vo Verceli do premennej GAS_KEY.');
  return k;
}

/**
 * Overí prístup k retieringu a pripraví hárky. Spusti raz pri nasadení (vyžiada si povolenia).
 */
function skontrolujNastavenie() {
  sheet_(); orgSheet_(); teamSheet_();
  const list = readClients_(true);
  Logger.log('Retiering: načítaných ' + list.length + ' klientov s vyplneným Final tier.');
  Logger.log('Tím: ' + readTeam_().members.length + ' ľudí.');
}

/* ---------- hárky ---------- */

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

const listRule_ = function (vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(false).build(); };

function sheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET, 0);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    const n = sh.getMaxRows() - 1;
    sh.getRange(2, C.tier, n, 1).setDataValidation(listRule_(values_(TIER)));
    sh.getRange(2, C.dovod, n, 1).setDataValidation(listRule_(values_(DOVOD)));
    sh.getRange(2, C.stav, n, 1).setDataValidation(listRule_(values_(STAV)));
    sh.getRange(2, C.termin, n, 1).setNumberFormat('d.M.yyyy');
    sh.getRange(2, C.zapisane, n, 1).setNumberFormat('d.M.yyyy H:mm');
    sh.getRange(2, C.upravene, n, 1).setNumberFormat('d.M.yyyy H:mm');
    sh.setColumnWidth(C.id, 90);
    sh.setColumnWidth(C.organizator, 240);
    sh.setColumnWidth(C.dovod, 170);
    sh.setColumnWidth(C.poznamka, 300);
  }
  return sh;
}

function orgSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(ORG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ORG_SHEET);
    sh.getRange(1, 1, 1, ORG_HEAD.length).setValues([ORG_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 4, sh.getMaxRows() - 1, 1).setDataValidation(listRule_(values_(TIER)));
    sh.getRange(2, 7, sh.getMaxRows() - 1, 1).setNumberFormat('d.M.yyyy H:mm');
    sh.setColumnWidth(2, 240);
  }
  return sh;
}

function teamSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(TEAM_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TEAM_SHEET);
    sh.getRange(1, 1, 1, TEAM_HEAD.length).setValues([TEAM_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, DEFAULT_TEAM.length, TEAM_HEAD.length).setValues(DEFAULT_TEAM);
    sh.setColumnWidth(4, 320);
  }
  return sh;
}

/* ---------- tím ---------- */

function readTeam_() {
  const sh = teamSheet_();
  const last = sh.getLastRow();
  if (last < 2) return {members: []};
  const vals = sh.getRange(2, 1, last - 1, TEAM_HEAD.length).getValues();
  const seen = {};
  const members = [];
  vals.forEach(function (r) {
    const id = String(r[0]).trim();
    if (!ID_RE.test(id) || id === ADMIN_ID || seen[id]) return;
    seen[id] = true;
    const a = String(r[2]).trim().toLowerCase();
    members.push({
      id: id,
      name: String(r[1]).trim().slice(0, 40) || id,
      active: !(r[2] === false || a === 'false' || a === 'nie' || a === '0'),
      emails: String(r[3] || '').split(/[,;\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean)
    });
  });
  return {members: members};
}

function memberName_(id, team) {
  if (id === ADMIN_ID) return 'Správca';
  const m = (team || readTeam_()).members.filter(function (x) { return x.id === id; })[0];
  return m ? m.name : '';
}

/* ---------- klienti z retieringu ---------- */

function norm_(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function tierCode_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (s === 'PREMIUM') return 'premium';
  if (s === 'PROFESSIONAL' || s === 'PROFI') return 'profi';
  if (s === 'LITE') return 'lite';
  return '';
}

function gmv_(v) {
  if (typeof v === 'number') return Math.max(0, Math.round(v));
  const n = Number(String(v == null ? '' : v).replace(/[^\d-]/g, ''));
  return isFinite(n) && n > 0 ? n : 0;
}

// Zoznam klientov s vyplneným „Final tier“. Riadky s rovnakým názvom sa spoja do jedného.
function readClients_(fresh) {
  const cache = CacheService.getScriptCache();
  const ck = 'clients-v' + VERSION;
  if (!fresh) {
    const meta = cache.get(ck);
    if (meta) {
      const n = Number(meta), keys = [];
      for (let i = 0; i < n; i++) keys.push(ck + '-' + i);
      const parts = cache.getAll(keys);
      if (keys.every(function (k) { return typeof parts[k] === 'string'; })) {
        try { return JSON.parse(keys.map(function (k) { return parts[k]; }).join('')); } catch (e) {}
      }
    }
  }
  const sh = SpreadsheetApp.openById(RETIER_ID).getSheetByName(RETIER_SHEET);
  if (!sh) throw {code: 'retier_missing'};
  const vals = sh.getDataRange().getValues();
  if (!vals.length) return [];
  const head = vals[0].map(function (h) { return String(h).trim(); });
  const col = {};
  Object.keys(RETIER_COLS).forEach(function (k) { col[k] = head.indexOf(RETIER_COLS[k]); });
  if (col.name < 0 || col.tier < 0 || col.owner < 0) throw {code: 'retier_columns'};
  const rank = {lite: 1, profi: 2, premium: 3};
  const map = {}, order = [];
  for (let r = 1; r < vals.length; r++) {
    const row = vals[r];
    const t = tierCode_(row[col.tier]);
    const name = String(row[col.name]).trim();
    if (!t || !name) continue;
    const key = norm_(name);
    if (!key) continue;
    const email = String(row[col.owner] || '').trim().toLowerCase();
    const vat = col.vat >= 0 ? String(row[col.vat]).replace(/\D/g, '') : '';
    let c = map[key];
    if (!c) { c = map[key] = {n: name.slice(0, 120), v: '', t: t, e: '', p: {}, g: 0}; order.push(key); }
    if (!c.v && vat) c.v = vat;
    if (rank[t] > rank[c.t]) c.t = t;
    if (email && email.indexOf('@') > 0 && (!c.e || /^service@/.test(c.e))) c.e = email;
    if (col.platform >= 0) String(row[col.platform] || '').split(',').forEach(function (p) { p = p.trim(); if (p && p !== '-') c.p[p] = 1; });
    if (col.gmv >= 0) c.g += gmv_(row[col.gmv]);
  }
  const list = order.map(function (k) { const c = map[k]; return {n: c.n, v: c.v, t: c.t, e: c.e, p: Object.keys(c.p).sort().join(', '), g: c.g}; });
  try {
    const json = JSON.stringify(list), size = 90000, n = Math.ceil(json.length / size), put = {};
    for (let i = 0; i < n; i++) put[ck + '-' + i] = json.slice(i * size, (i + 1) * size);
    put[ck] = String(n);
    cache.putAll(put, CACHE_SECONDS);
  } catch (e) {}
  return list;
}

/* ---------- darčeky ---------- */

function values_(map) {
  return Object.keys(map).map(function (k) { return map[k]; });
}

// Text z tabuľky (aj ručne zapísaný) → kód pre aplikáciu.
function toCode_(map, v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (map[s]) return s;
  const low = s.toLowerCase();
  for (const k in map) if (map[k].toLowerCase() === low) return k;
  return '';
}

const time_ = function (v) { return v instanceof Date ? v.getTime() : 0; };
function isoDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d\d-\d\d$/.test(s) ? s : '';
}
const txt_ = function (v, n) { return String(v == null ? '' : v).replace(/^'/, '').trim().slice(0, n); };

function readAll_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, HEAD.length).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    const g = function (h) { return r[C[h] - 1]; };
    const id = String(g('id')).trim();
    if (!id && !String(g('organizator')).trim()) return; // prázdny riadok
    out.push({
      row: i + 2, id: id,
      organizator: txt_(g('organizator'), 120), ico: String(g('ico')).replace(/\D/g, '').slice(0, 12),
      tier: toCode_(TIER, g('tier')), kam: txt_(g('kam'), 40),
      dovod: toCode_(DOVOD, g('dovod')), pocet: Math.max(1, Math.min(999, Math.round(Number(g('pocet')) || 1))),
      stav: toCode_(STAV, g('stav')) || 'navrhnute', termin: isoDate_(g('termin')), poznamka: txt_(g('poznamka'), 500),
      zapisal: txt_(g('zapisal'), 40), zapisane: time_(g('zapisane')),
      upravil: txt_(g('upravil'), 40), upravene: time_(g('upravene')),
      klient: String(g('klient')).trim() || norm_(g('organizator')), o: String(g('vlastnik')).trim()
    });
  });
  // Riadky pridané ručne bez id dostanú id, aby sa dali upraviť aj v aplikácii (len správcom).
  let fixed = false;
  out.forEach(function (it) {
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(it.id)) { it.id = newId_(); sh.getRange(it.row, C.id).setValue(it.id); fixed = true; }
  });
  if (fixed) SpreadsheetApp.flush();
  return out;
}

function readOrgs_() {
  const sh = orgSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ORG_HEAD.length).getValues().map(function (r) {
    const n = txt_(r[1], 120);
    return n ? {id: String(r[0]).trim(), n: n, v: String(r[2]).replace(/\D/g, '').slice(0, 12), t: toCode_(TIER, r[3]) || 'lite', kam: txt_(r[4], 40), by: txt_(r[5], 40), at: time_(r[6])} : null;
  }).filter(Boolean);
}

// Zoznam pre prehliadač: bez identifikátora vlastníka, len s príznakom, či záznam patrí prihlásenému.
function listFor_(req) {
  const me = memberOf_(req);
  return {
    v: VERSION, team: readTeam_(), orgs: readOrgs_(),
    items: readAll_().map(function (it) {
      return {id: it.id, organizator: it.organizator, ico: it.ico, tier: it.tier, kam: it.kam, dovod: it.dovod, pocet: it.pocet,
        stav: it.stav, termin: it.termin, poznamka: it.poznamka, zapisal: it.zapisal, zapisane: it.zapisane,
        upravil: it.upravil, upravene: it.upravene, klient: it.klient, mine: !!me && it.o === me};
    })
  };
}

const memberOf_ = function (req) { const m = String(req && req.by || ''); return ID_RE.test(m) ? m : ''; };
const isAdmin_ = function (req) { return !!req && req.role === 'a'; };

function checkOwner_(row, req) {
  if (isAdmin_(req)) return;
  const me = memberOf_(req);
  const owner = String(sheet_().getRange(row, C.vlastnik).getValue()).trim();
  if (!me || owner !== me) throw {code: 'forbidden'};
}

// Text vložený do tabuľky sa nesmie správať ako vzorec.
const safe_ = function (s) { return /^[=+\-@]/.test(s) ? "'" + s : s; };

function clean_(item, team, keepKam) {
  if (!item || typeof item !== 'object') throw {code: 'bad_request'};
  const s = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n); };
  const pocet = Number(item.pocet);
  const c = {
    kam: s(item.kam, 40), dovod: DOVOD[item.dovod] ? item.dovod : '', stav: STAV[item.stav] ? item.stav : '',
    pocet: pocet, termin: /^\d{4}-\d\d-\d\d$/.test(String(item.termin || '')) ? String(item.termin) : '',
    poznamka: s(item.poznamka, 500)
  };
  if (!c.kam || !c.dovod || !c.stav || !(Math.floor(pocet) === pocet && pocet >= 1 && pocet <= 999)) throw {code: 'bad_request'};
  if (c.dovod === 'fix' && c.poznamka.length < 3) throw {code: 'note_required'};
  const inTeam = team.members.some(function (m) { return m.active && m.name === c.kam; });
  if (!inTeam && c.kam !== keepKam) throw {code: 'unknown_member'};
  return c;
}

function findRow_(id) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(String(id))) throw {code: 'bad_request'};
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

// Organizátor pre nový darček: buď klient z retieringu / z hárku nových (item.klient), alebo nový (org).
function resolveClient_(item, org, req, team) {
  if (org && typeof org === 'object') {
    const n = String(org.organizator || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const t = TIER[org.tier] ? org.tier : '';
    if (!n || !t) throw {code: 'bad_request'};
    const key = norm_(n);
    const exists = readClients_(false).some(function (c) { return norm_(c.n) === key; }) ||
      readOrgs_().some(function (o) { return norm_(o.n) === key; });
    if (exists) throw {code: 'org_exists'};
    const ico = String(org.ico || '').replace(/\D/g, '').slice(0, 12);
    const kam = String(item && item.kam || '').trim().slice(0, 40);
    orgSheet_().appendRow([newId_(), safe_(n), ico, TIER[t], kam, memberName_(memberOf_(req), team), new Date()]);
    return {organizator: n, ico: ico, tier: t, klient: key};
  }
  const key = String(item && item.klient || '').trim();
  if (!key) throw {code: 'bad_request'};
  const c = readClients_(false).filter(function (x) { return norm_(x.n) === key; })[0];
  if (c) return {organizator: c.n, ico: c.v, tier: c.t, klient: key};
  const o = readOrgs_().filter(function (x) { return norm_(x.n) === key; })[0];
  if (o) return {organizator: o.n, ico: o.v, tier: o.t, klient: key};
  throw {code: 'unknown_client'};
}

function addItem_(item, org, req) {
  const me = memberOf_(req);
  if (!me) throw {code: 'identity_required'};
  const team = readTeam_();
  const c = clean_(item, team);
  const cl = resolveClient_(item, org, req, team);
  const sh = sheet_();
  if (sh.getLastRow() - 1 >= MAX_ROWS) throw {code: 'quota_exceeded'};
  const now = new Date(), who = memberName_(me, team);
  const row = {};
  row.id = newId_(); row.organizator = safe_(cl.organizator); row.ico = cl.ico; row.tier = TIER[cl.tier] || '';
  row.kam = c.kam; row.dovod = DOVOD[c.dovod]; row.pocet = c.pocet; row.stav = STAV[c.stav];
  row.termin = c.termin ? new Date(c.termin + 'T12:00:00') : ''; row.poznamka = safe_(c.poznamka);
  row.zapisal = who; row.zapisane = now; row.upravil = who; row.upravene = now; row.klient = cl.klient; row.vlastnik = me;
  sh.appendRow(HEAD.map(function (h) { return row[h]; }));
}

function updateItem_(id, item, req) {
  const me = memberOf_(req);
  if (!me) throw {code: 'identity_required'};
  const row = findRow_(id);
  if (!row) throw {code: 'not_found'};
  checkOwner_(row, req);
  const sh = sheet_();
  const team = readTeam_();
  const c = clean_(item, team, txt_(sh.getRange(row, C.kam).getValue(), 40));
  // Mení sa len to, čo je vo formulári. Organizátor, tier a autor zostávajú.
  sh.getRange(row, C.kam, 1, 6).setValues([[c.kam, DOVOD[c.dovod], c.pocet, STAV[c.stav],
    c.termin ? new Date(c.termin + 'T12:00:00') : '', safe_(c.poznamka)]]);
  sh.getRange(row, C.upravil, 1, 2).setValues([[memberName_(me, team), new Date()]]);
}

function deleteItem_(id, req) {
  if (!memberOf_(req)) throw {code: 'identity_required'};
  const row = findRow_(id);
  if (!row) return;
  checkOwner_(row, req);
  sheet_().deleteRow(row);
}

/* ---------- pomocné ---------- */

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw {code: 'busy'};
  try {
    const r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
