(function(){
'use strict';

const CFG = Object.assign({apiUrl:'/api/data', teamName:'', pollSeconds:60}, window.DARCEKY_CONFIG || {});
const POLL_MS = Math.max(20, Number(CFG.pollSeconds) || 60) * 1000;
const SERVER_VERSION = 1; // verzia apps-script/Code.gs, s ktorou táto stránka počíta
const ADMIN_ID = '_admin';

/* ---------- číselníky ---------- */
const TIERS = [{v:'premium', l:'PREMIUM', r:3}, {v:'profi', l:'PROFI', r:2}, {v:'lite', l:'LITE', r:1}];
const DOVODY = [
  {v:'improvement', l:'Business improvement', d:'Klient rastie alebo rozšíril spoluprácu: vyšší obrat, nová platforma, viac akcií. Darček je poďakovanie a motivácia pokračovať.'},
  {v:'stable', l:'Business stable', d:'Dlhodobý spoľahlivý partner bez väčších zmien. Darček je poďakovanie za lojalitu a udržanie vzťahu.'},
  {v:'fix', l:'Business fix', d:'Vzťah treba napraviť: problém, reklamácia, výpadok, nespokojnosť alebo riziko odchodu. Poznámka je povinná.'}
];
const STAVY = [{v:'navrhnute', l:'Navrhnuté'}, {v:'schvalene', l:'Schválené'}, {v:'objednane', l:'Objednané'}, {v:'odovzdane', l:'Odovzdané'}];
const TL = Object.fromEntries(TIERS.map(k => [k.v, k]));
const DL = Object.fromEntries(DOVODY.map(k => [k.v, k]));
const SL = Object.fromEntries(STAVY.map(k => [k.v, k]));
const ERR = {
  old_server: 'Na serveri beží stará verzia Apps Scriptu. Nasaď v Apps Scripte novú verziu (Spravovať nasadenia › Nová verzia).',
  proxy_not_configured: 'Server nie je nastavený: vo Verceli chýba GAS_URL alebo GAS_KEY.',
  proxy_key_mismatch: 'Tímový kľúč vo Verceli (GAS_KEY) nesedí s kľúčom v Apps Scripte.',
  not_configured: 'V Apps Scripte ešte nie je vytvorený tímový kľúč.',
  retier_missing: 'Server nenašiel retiering (hárok Source). Skontroluj RETIER_ID v Apps Scripte a prístup k tabuľke.',
  retier_columns: 'V retieringu chýbajú stĺpce Promoter, Final tier alebo Responsible new.',
  quota_exceeded: 'Tabuľka je plná, ďalšie darčeky sa nedajú pridať.',
  busy: 'Server je práve zaneprázdnený. Skús to o chvíľu znova.',
  not_found: 'Tento darček medzitým niekto odstránil.',
  bad_request: 'Údaje sa nepodarilo uložiť. Skontroluj, či sú vyplnené všetky polia.',
  note_required: 'Pri Business fix napíš do poznámky, čo sa stalo.',
  unknown_member: 'Vybraný KAM už nie je v zozname tímu. Obnov stránku a vyber znova.',
  unknown_client: 'Tento klient už v retieringu nie je. Obnov stránku.',
  org_exists: 'Tento organizátor už v zozname je. Nájdeš ho v portfóliu.',
  forbidden: 'Tento darček môže upraviť len ten, kto ho zapísal, alebo správca.',
  identity_required: 'Najprv vyber, kto si.'
};

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lsGet = k => { try { return localStorage.getItem('darceky.'+k); } catch(e){ return null; } };
const lsSet = (k,v) => { try { localStorage.setItem('darceky.'+k, v); } catch(e){} };
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const collator = new Intl.Collator('sk', {sensitivity:'base'});
const nf = new Intl.NumberFormat('sk-SK');
const toCount = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, 999) : 1; };
const plural = (n, one, few, many) => n === 1 ? one : (n >= 2 && n <= 4 ? few : many);
const pad = n => String(n).padStart(2,'0');
const d0 = new Date();
const TODAY = d0.getFullYear()+'-'+pad(d0.getMonth()+1)+'-'+pad(d0.getDate());
const fmtDate = iso => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso||''); return m ? (+m[3])+'. '+(+m[2])+'. '+m[1] : ''; };
const fmtTs = t => { if(!t) return ''; const d = new Date(t); return d.getDate()+'. '+(d.getMonth()+1)+'. '+d.getFullYear()+' '+d.getHours()+':'+pad(d.getMinutes()); };
const fmtShort = t => { if(!t) return ''; const d = new Date(t); return d.getDate()+'. '+(d.getMonth()+1)+'.'; };
function fmtGmv(g){
  if(!g) return '–';
  if(g >= 1e6) return nf.format(Math.round(g/1e5)/10) + ' mil. Kč';
  if(g >= 1e3) return nf.format(Math.round(g/1e3)) + ' tis. Kč';
  return nf.format(g) + ' Kč';
}
const isLate = g => !!g.termin && g.termin < TODAY && g.stav !== 'odovzdane';
const tierTag = t => TL[t] ? '<span class="tag tr-'+t+'">'+TL[t].l+'</span>' : '<span class="plain">–</span>';

if(CFG.teamName){ $('#brand').textContent = CFG.teamName + ': darčeky pre organizátorov'; document.title = CFG.teamName + ': darčeky pre organizátorov'; }

/* ---------- stav ---------- */
const S = {
  mode:'loading',   // loading | pick | live | local
  role:'u', me:'', team:[], teamLoaded:false,
  base:[], baseLoaded:false, baseErr:'', orgs:[], items:[], loaded:false,
  err:'', busy:0, lastOk:0,
  tab:'p', form:null,   // null | {mode:'client', key} | {mode:'new'} | {mode:'edit', id}
  pq:'', ptier:'', pscope:'me', plimit:120,
  gq:'', gkam:'', gstav:'', gdovod:''
};
let CMAP = new Map(), EMAIL = {}, delId = null;

const isAdmin = () => S.role === 'a' || S.mode === 'local';
const canEdit = () => S.mode === 'live' || S.mode === 'local';
const canTouch = x => !!x && canEdit() && (x.mine || isAdmin());
const activeTeam = () => S.team.filter(m => m.active);
const myMember = () => S.team.find(m => m.id === S.me) || null;
const myName = () => S.me === ADMIN_ID ? 'Správca' : (myMember() ? myMember().name : '');

function rebuild(){
  EMAIL = {};
  S.team.forEach(m => (m.emails || []).forEach(e => { EMAIL[e] = m.name; }));
  const m = new Map();
  S.base.forEach(c => { m.set(c.key, Object.assign({}, c, {k: EMAIL[c.e] || ''})); });
  S.orgs.forEach(o => { if(!m.has(o.key)) m.set(o.key, o); });
  CMAP = m;
}
function cleanItem(b){
  if(!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id) return null;
  return {
    id: b.id.slice(0,40), organizator: str(b.organizator, 120), ico: str(b.ico, 12),
    tier: TL[b.tier] ? b.tier : '', kam: str(b.kam, 40), dovod: DL[b.dovod] ? b.dovod : '',
    pocet: toCount(b.pocet), stav: SL[b.stav] ? b.stav : 'navrhnute',
    termin: /^\d{4}-\d\d-\d\d$/.test(b.termin || '') ? b.termin : '', poznamka: str(b.poznamka, 500),
    zapisal: str(b.zapisal, 40), zapisane: +b.zapisane || 0, upravil: str(b.upravil, 40), upravene: +b.upravene || 0,
    klient: str(b.klient, 160) || norm(b.organizator), mine: b.mine === true
  };
}
function cleanTeam(t){
  const list = t && Array.isArray(t.members) ? t.members : [];
  return list.filter(m => m && typeof m.id === 'string' && typeof m.name === 'string')
    .map(m => ({id:m.id, name:m.name.slice(0,40), active:m.active !== false, emails:Array.isArray(m.emails) ? m.emails.map(e => String(e).toLowerCase()) : []}));
}
function cleanOrg(o){
  const n = o && str(o.n, 120);
  return n ? {n, v:str(o.v, 12), t:TL[o.t] ? o.t : 'lite', k:str(o.kam, 40), p:'', g:0, extra:true, key:norm(n)} : null;
}
function cleanClient(c){
  return c && typeof c.n === 'string' && TL[c.t] ? {n:c.n, v:String(c.v || ''), t:c.t, e:String(c.e || '').toLowerCase(), p:String(c.p || ''), g:+c.g || 0, key:norm(c.n)} : null;
}
const giftsFor = key => S.items.filter(g => g.klient === key);

/* ---------- server ---------- */
function goLogin(){ location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); }
async function api(action, extra){
  let r;
  try {
    r = await fetch(CFG.apiUrl, {
      method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({action}, extra || {}))
    });
  } catch(e){ throw {code:'network'}; }
  if(r.status === 401){ goLogin(); throw {code:'login_required'}; }
  let j = null;
  try { j = await r.json(); } catch(e){ throw {code:'network'}; }
  if(!j || !j.ok) throw {code: (j && j.error) || 'network'};
  return j.data || {};
}
async function whoami(member){
  let r;
  try {
    r = await fetch('/api/whoami', member === undefined ? {credentials:'same-origin', cache:'no-store'}
      : {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({member})});
  } catch(e){ throw {code:'network'}; }
  if(r.status === 401){ goLogin(); throw {code:'login_required'}; }
  let j = null;
  try { j = await r.json(); } catch(e){ throw {code:'network'}; }
  if(!j || !j.ok) throw {code: (j && j.error) || 'network'};
  return j.data || {};
}
function apply(data){
  if(!data) return;
  if(data.role === 'a' || data.role === 'u') S.role = data.role;
  if(data.team){ S.team = cleanTeam(data.team); S.teamLoaded = true; }
  if(Array.isArray(data.orgs)) S.orgs = data.orgs.map(cleanOrg).filter(Boolean);
  if(Array.isArray(data.items)){
    S.items = data.items.map(cleanItem).filter(Boolean);
    S.loaded = true; S.lastOk = Date.now();
    if(S.form && S.form.mode === 'edit' && !S.items.some(x => x.id === S.form.id)) S.form = null;
  }
  rebuild();
}
let loading = false;
async function refresh(){
  if(S.mode !== 'live' && S.mode !== 'loading') return;
  if(loading || S.busy) return;
  loading = true;
  try {
    const d = await api('list');
    if(!(Number(d.v) >= SERVER_VERSION)) throw {code:'old_server'};
    if(!S.busy) apply(d);
    S.mode = 'live';
    if(S.err && S.err.indexOf('uložiť') === -1) S.err = '';
  } catch(e){
    if(e.code === 'identity_required'){ loading = false; startPick(); return; }
    if(e.code !== 'login_required') S.err = ERR[e.code] || (S.loaded ? 'Spojenie so serverom vypadlo, zoznam môže byť neaktuálny.' : 'Zoznam sa nepodarilo načítať. Skontroluj pripojenie.');
  } finally {
    loading = false;
    render();
  }
}
async function loadClients(force){
  S.baseErr = ''; renderPortfolio();
  try {
    const d = await api('clients', force ? {refresh:true} : {});
    S.base = (Array.isArray(d.clients) ? d.clients : []).map(cleanClient).filter(Boolean);
    S.baseLoaded = true;
    if(force) toast('Klienti sú načítaní nanovo z retieringu.');
  } catch(e){
    if(e.code === 'identity_required') return;
    S.baseErr = ERR[e.code] || 'Zoznam klientov z retieringu sa nepodarilo načítať.';
  }
  rebuild(); render();
}

/* ---------- brána „Kto si?“ ---------- */
async function start(){
  render();
  try {
    const w = await whoami();
    S.role = w.role === 'a' ? 'a' : 'u';
    if(w.member && w.member !== '-'){ S.me = w.member; S.mode = 'loading'; begin(); }
    else await startPick();
  } catch(e){
    if(e.code === 'login_required') return;
    S.err = ERR[e.code] || 'Server je nedostupný. Skúšam znova…';
    render();
    setTimeout(start, 5000);
  }
}
async function startPick(){
  S.mode = 'pick'; S.form = null;
  render();
  // Kým nie je vybrané meno, server dáta nevydá. Zoznam mien sa preto berie z /api/team.
  try {
    const r = await fetch('/api/team', {credentials:'same-origin', cache:'no-store'});
    if(r.status === 401){ goLogin(); return; }
    const j = await r.json();
    if(!j || !j.ok) throw {code: (j && j.error) || 'network'};
    S.team = cleanTeam(j.data); S.teamLoaded = true; S.err = '';
  } catch(e){ S.err = ERR[e.code] || 'Zoznam tímu sa nepodarilo načítať. Obnov stránku.'; }
  render();
}
async function chooseMe(id){
  document.querySelectorAll('#pickList button').forEach(b => { b.disabled = true; });
  try {
    const w = await whoami(id);
    S.me = w.member; S.role = w.role === 'a' ? 'a' : 'u';
    S.mode = 'loading'; S.err = ''; S.pscope = 'me'; $('#pScope').value = 'me'; S.tab = 'p';
    begin();
  } catch(e){
    toast(ERR[e.code] || 'Meno sa nepodarilo uložiť. Skús to znova.');
    render();
  }
}
let begun = false;
function begin(){
  render();
  refresh();
  if(!S.baseLoaded) loadClients(false);
  if(!begun){
    begun = true;
    setInterval(() => { if(document.visibilityState === 'visible') refresh(); }, POLL_MS);
    setInterval(() => { if(document.visibilityState === 'visible' && S.mode === 'live') loadClients(false); }, 15 * 60 * 1000);
  }
}

/* ---------- formulár ---------- */
function chipsHtml(name, opts, withDef, cls){
  return opts.map(o => '<label class="chip '+cls+o.v+'"><input type="radio" name="'+name+'" value="'+o.v+'"><span><i class="t">'+esc(o.l)+(withDef ? '<small>'+esc(o.d)+'</small>' : '')+'</i></span></label>').join('');
}
$('#cTier').innerHTML = chipsHtml('tier', TIERS, false, 'x-');
$('#cDovod').innerHTML = chipsHtml('dovod', DOVODY, true, 'x-');
$('#cStav').innerHTML = chipsHtml('stav', STAVY, false, 'x-');
$('#defList').innerHTML = DOVODY.map(o => '<dt class="x-'+o.v+'">'+esc(o.l)+'</dt><dd>'+esc(o.d)+'</dd>').join('');
$('#pTier').innerHTML = '<option value="">Všetky tiery</option>' + TIERS.map(k => '<option value="'+k.v+'">'+k.l+'</option>').join('');
$('#gStav').innerHTML = '<option value="">Všetky stavy</option><option value="late">Po termíne</option>' + STAVY.map(k => '<option value="'+k.v+'">'+k.l+'</option>').join('');
$('#gDovod').innerHTML = '<option value="">Všetky dôvody</option>' + DOVODY.map(k => '<option value="'+k.v+'">'+k.l+'</option>').join('');
let teamSig = '';
function renderTeamSelects(extraKam){
  const names = activeTeam().map(m => m.name);
  const sig = names.join('|') + '#' + (extraKam || '');
  if(sig === teamSig) return; teamSig = sig;
  const cur = $('#fKam').value, all = names.slice();
  if(extraKam && all.indexOf(extraKam) === -1) all.push(extraKam);
  $('#fKam').innerHTML = '<option value="">vyber KAM</option>' + all.map(n => '<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
  $('#fKam').value = all.indexOf(cur) !== -1 ? cur : '';
  const gk = $('#gKam').value;
  $('#gKam').innerHTML = '<option value="">Všetci KAM</option><option value="__mine">Mnou zapísané</option>' + names.map(n => '<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
  $('#gKam').value = gk;
}

const radio = n => { const el = document.querySelector('input[name="'+n+'"]:checked'); return el ? el.value : ''; };
const setRadio = (n, v) => document.querySelectorAll('input[name="'+n+'"]').forEach(el => { el.checked = el.value === v; });
const defaultKam = clientKam => {
  const names = activeTeam().map(m => m.name);
  if(clientKam && names.indexOf(clientKam) !== -1) return clientKam;
  return names.indexOf(myName()) !== -1 ? myName() : '';
};

function clearMarks(){
  document.querySelectorAll('#form [aria-invalid]').forEach(el => el.setAttribute('aria-invalid','false'));
  document.querySelectorAll('#form .fieldset-bad,#form .field-bad').forEach(el => el.classList.remove('fieldset-bad','field-bad'));
}
function fillForm(v){
  renderTeamSelects(v.kam);
  $('#fOrg').value = v.organizator || ''; $('#fIco').value = v.ico || '';
  setRadio('tier', v.tier || ''); setRadio('dovod', v.dovod || ''); setRadio('stav', v.stav || 'navrhnute');
  $('#fKam').value = v.kam || '';
  $('#fPocet').value = String(v.pocet || 1); $('#fTermin').value = v.termin || ''; $('#fNote').value = v.poznamka || '';
  clearMarks(); syncNoteReq();
}
function guard(){
  if(canEdit()) return true;
  toast(S.mode === 'pick' ? 'Najprv vyber, kto si.' : 'Zoznam sa ešte načítava.');
  return false;
}
function openClient(key){
  if(!guard()) return;
  const c = CMAP.get(key); if(!c) return;
  S.form = {mode:'client', key};
  fillForm({kam: defaultKam(c.k)});
  renderForm(); renderPortfolio(); focusForm('#cDovod input');
}
function openNew(prefill){
  if(!guard()) return;
  S.form = {mode:'new'};
  fillForm({kam: defaultKam(''), organizator: prefill || ''});
  renderForm(); renderPortfolio(); focusForm('#fOrg');
}
function openEdit(id){
  const g = S.items.find(x => x.id === id);
  if(!g) return;
  if(!canTouch(g)){ toast(ERR.forbidden); return; }
  S.form = {mode:'edit', id};
  fillForm(g);
  renderForm(); renderGifts(); focusForm('#cDovod input:checked');
}
function closeForm(){ S.form = null; clearMarks(); renderForm(); renderPortfolio(); renderGifts(); }
function focusForm(sel){
  const narrow = window.matchMedia('(max-width:900px)').matches;
  if(narrow) $('#formCard').scrollIntoView({behavior:'smooth', block:'start'});
  const el = document.querySelector(sel) || document.querySelector('#cDovod input');
  if(el) el.focus({preventScroll: narrow});
}
function syncNoteReq(){
  const req = radio('dovod') === 'fix';
  $('#fNoteLbl').innerHTML = req ? 'Poznámka <span class="opt">(povinná pri Business fix: čo sa stalo a ako to riešime)</span>' : 'Poznámka <span class="opt">(nepovinné)</span>';
}
function readForm(){
  return {
    organizator: $('#fOrg').value.trim().replace(/\s+/g,' ').slice(0,120),
    ico: $('#fIco').value.replace(/\D/g,'').slice(0,12),
    tier: radio('tier'), kam: $('#fKam').value, dovod: radio('dovod'), stav: radio('stav'),
    pocetRaw: $('#fPocet').value.trim(), termin: $('#fTermin').value, poznamka: $('#fNote').value.trim().slice(0,500)
  };
}
function validate(d, isNew){
  const bad = [], msgs = [];
  const markF = (el, b) => { el.classList.toggle('fieldset-bad', b); if(b) bad.push(el.querySelector('input')); };
  const markI = (el, wrap, b) => { el.setAttribute('aria-invalid', String(b)); wrap.classList.toggle('field-bad', b); if(b) bad.push(el); };
  if(isNew){ markI($('#fOrg'), $('#fOrgWrap'), !d.organizator); markF($('#fsTier'), !d.tier); }
  markI($('#fKam'), $('#fKamWrap'), !d.kam);
  markF($('#fsDovod'), !d.dovod);
  const pn = Number(d.pocetRaw), pBad = !(Number.isInteger(pn) && pn >= 1 && pn <= 999);
  markI($('#fPocet'), $('#fPocetWrap'), pBad); if(pBad) msgs.push('Počet musí byť celé číslo od 1 do 999.');
  markF($('#fsStav'), !d.stav);
  const nBad = d.dovod === 'fix' && d.poznamka.length < 3;
  markI($('#fNote'), $('#fNoteWrap'), nBad); if(nBad) msgs.push(ERR.note_required);
  if(bad.length){
    if(bad[0]) bad[0].focus();
    toast(msgs.length && bad.length === msgs.length ? msgs[0] : 'Vyplň prosím zvýraznené polia.');
    return false;
  }
  return true;
}

async function submit(){
  const f = S.form;
  if(!f || !guard()) return;
  const d = readForm(), isNew = f.mode === 'new';
  if(!validate(d, isNew)) return;
  if(isNew && CMAP.has(norm(d.organizator))){ toast('Tento organizátor už v zozname je, otváram ho.'); openClient(norm(d.organizator)); return; }
  const item = {kam:d.kam, dovod:d.dovod, pocet:Number(d.pocetRaw), stav:d.stav, termin:d.termin, poznamka:d.poznamka};
  const btn = $('#submit'); btn.disabled = true;
  try {
    await write(async () => {
      if(S.mode === 'local') return saveLocalItem(f, d, item);
      if(f.mode === 'edit') apply(await api('update', {id:f.id, item}));
      else if(isNew) apply(await api('add', {item, org:{organizator:d.organizator, ico:d.ico, tier:d.tier}}));
      else apply(await api('add', {item: Object.assign({klient:f.key}, item)}));
    });
    toast(f.mode === 'edit' ? 'Zmena je uložená.' : (isNew ? 'Nový organizátor aj darček sú uložené.' : 'Darček je uložený.'));
    S.form = null; render();
  } catch(e){ onWriteError(e); }
  finally { btn.disabled = false; }
}
async function remove(id){
  const g = S.items.find(x => x.id === id);
  if(!canTouch(g)){ toast(ERR.forbidden); return; }
  try {
    await write(async () => {
      if(S.mode === 'local'){ S.items = S.items.filter(x => x.id !== id); saveLocal(); }
      else apply(await api('delete', {id}));
    });
    if(S.form && S.form.id === id) S.form = null;
    toast('Darček je odstránený.');
    render();
  } catch(e){ onWriteError(e); }
}
async function write(fn){
  S.busy++; renderSync();
  try { await fn(); if(S.err) S.err = ''; }
  finally { S.busy--; renderSync(); }
}
function onWriteError(e){
  const code = e && e.code;
  if(code === 'login_required') return;
  if(code === 'identity_required'){ startPick(); return; }
  if(code === 'note_required' || code === 'org_exists' || code === 'forbidden' || code === 'unknown_member'){ toast(ERR[code]); refresh(); return; }
  S.err = ERR[code] || 'Zmenu sa nepodarilo uložiť. Skontroluj pripojenie a skús to znova.';
  if(code === 'not_found') refresh();
  render();
}

/* ---------- bez servera (len na skúšanie vzhľadu) ---------- */
function startLocal(){
  S.mode = 'local'; S.role = 'a'; S.me = 'ukazka';
  S.team = (Array.isArray(CFG.localTeam) ? CFG.localTeam : ['Ukážka']).map((n, i) => ({id: i ? 'm'+i : 'ukazka', name:n, active:true, emails:['kam'+i+'@example.com']}));
  S.teamLoaded = true;
  S.base = (Array.isArray(CFG.localClients) ? CFG.localClients : []).map(cleanClient).filter(Boolean);
  S.baseLoaded = true;
  let data = null;
  try { data = JSON.parse(lsGet('local') || 'null'); } catch(e){}
  S.items = data && Array.isArray(data.items) ? data.items.map(cleanItem).filter(Boolean) : [];
  S.orgs = data && Array.isArray(data.orgs) ? data.orgs.map(cleanOrg).filter(Boolean) : [];
  S.loaded = true; rebuild(); render();
}
function saveLocal(){ lsSet('local', JSON.stringify({items:S.items, orgs:S.orgs.map(o => ({n:o.n, v:o.v, t:o.t, kam:o.k}))})); }
function saveLocalItem(f, d, item){
  const now = Date.now();
  let base;
  if(f.mode === 'edit') base = S.items.find(x => x.id === f.id);
  else if(f.mode === 'new'){ S.orgs.push(cleanOrg({n:d.organizator, v:d.ico, t:d.tier, kam:d.kam})); base = {organizator:d.organizator, ico:d.ico, tier:d.tier, klient:norm(d.organizator), zapisal:myName(), zapisane:now}; }
  else { const c = CMAP.get(f.key); base = {organizator:c.n, ico:c.v, tier:c.t, klient:c.key, zapisal:myName(), zapisane:now}; }
  const it = cleanItem(Object.assign({id: f.mode === 'edit' ? f.id : 'l'+now.toString(36)}, base, item, {upravil:myName(), upravene:now, mine:true}));
  S.items = S.items.filter(x => x.id !== it.id).concat([it]);
  saveLocal(); rebuild();
}

/* ---------- vykresľovanie ---------- */
function render(){ renderSync(); renderTop(); renderPicker(); renderStats(); renderTeamSelects(); renderForm(); renderTabs(); renderPortfolio(); renderGifts(); }
function renderSync(){
  const el = $('#sync');
  let t, cls = '';
  if(S.mode === 'pick' && !S.err){ t = 'Vyber, kto si'; cls = 'busy'; }
  else if(S.err){ t = S.err; cls = 'err'; }
  else if(S.mode === 'loading'){ t = 'Pripájam sa…'; cls = 'busy'; }
  else if(S.busy){ t = 'Ukladám…'; cls = 'busy'; }
  else if(S.mode === 'local'){ t = 'Ukladá sa len v tomto prehliadači'; cls = 'local'; }
  else t = 'Uložené pre celý tím';
  if(el.textContent !== t) el.textContent = t;
  el.className = 'sync ' + cls;
}
function renderTop(){
  const show = S.mode !== 'pick' && !!S.me && S.mode !== 'local';
  $('#meBox').hidden = !show;
  if(show) $('#meName').textContent = myName() || S.me;
  $('#role').hidden = !(S.role === 'a' && S.mode !== 'local');
}
function renderPicker(){
  const pick = S.mode === 'pick';
  $('#picker').hidden = !pick; $('#board').hidden = pick; $('#app').hidden = pick;
  if(!pick) return;
  $('#pickSub').textContent = S.role === 'a'
    ? 'Prihlásil si sa ako správca: môžeš upravovať všetky darčeky. Vyber, pod akým menom sa budú zápisy ukladať.'
    : 'Vyber svoje meno. Zobrazí sa ti tvoje portfólio z retieringu a upravovať budeš môcť len darčeky, ktoré zapíšeš ty.';
  const list = $('#pickList');
  if(!S.teamLoaded){ list.innerHTML = '<li class="muted">'+(S.err ? esc(S.err) : 'Načítavam tím…')+'</li>'; return; }
  let h = activeTeam().map(m => '<li><button class="pick" data-me="'+esc(m.id)+'">'+esc(m.name)+'</button></li>').join('');
  if(S.role === 'a') h += '<li><button class="pick adm" data-me="'+ADMIN_ID+'">Správca, nie som v zozname</button></li>';
  list.innerHTML = h || '<li class="muted">V hárku Tím zatiaľ nikto nie je.</li>';
}
function renderStats(){
  if(!S.loaded){ $('#stats').innerHTML = ''; return; }
  const it = S.items, sum = a => a.reduce((s, x) => s + x.pocet, 0);
  const total = sum(it), orgs = new Set(it.map(x => x.klient)).size, late = it.filter(isLate).length;
  const st = (n, t, c) => '<div class="stat '+(c||'')+'"><span class="n">'+n+'</span><span class="t">'+t+'</span></div>';
  $('#stats').innerHTML =
    st(total, plural(total,'darček','darčeky','darčekov'), 'hl') +
    st(orgs, plural(orgs,'organizátor','organizátori','organizátorov')) +
    st(late, 'po termíne', late ? 'pk' : '') +
    st(sum(it.filter(x => x.stav === 'navrhnute')), 'čaká na schválenie') +
    st(sum(it.filter(x => x.stav === 'odovzdane')), 'odovzdaných', 'gr') +
    DOVODY.map(k => st(sum(it.filter(x => x.dovod === k.v)), k.l, k.v === 'fix' ? 'pk' : (k.v === 'improvement' ? 'gr' : ''))).join('');
}
function renderForm(){
  const f = S.form;
  $('#formEmpty').hidden = !!f;
  $('#form').hidden = !f;
  $('#newOrgBtn').hidden = !canEdit();
  if(!f){ $('#formTitle').textContent = 'Pridať darček'; return; }
  const isNew = f.mode === 'new';
  $('#newFields').hidden = !isNew; $('#clientBox').hidden = isNew;
  $('#formTitle').textContent = f.mode === 'edit' ? 'Upraviť darček' : (isNew ? 'Nový organizátor' : 'Pridať darček');
  $('#formHint').hidden = !isNew;
  $('#formHint').textContent = 'Organizátor, ktorý nie je v retieringu. Uloží sa do tabuľky darčekov a nabudúce ho nájdeš v portfóliu.';
  $('#submit').textContent = f.mode === 'edit' ? 'Uložiť zmenu' : (isNew ? 'Uložiť organizátora a darček' : 'Uložiť darček');
  let c = null, g = null;
  if(f.mode === 'client') c = CMAP.get(f.key);
  if(f.mode === 'edit'){ g = S.items.find(x => x.id === f.id); c = g ? CMAP.get(g.klient) : null; }
  if(!isNew){
    const meta = [tierTag(g ? g.tier : (c ? c.t : ''))];
    const ico = c ? c.v : (g ? g.ico : '');
    if(ico) meta.push('IČO ' + esc(ico));
    if(c && c.extra) meta.push('<span class="tag new">pridaný ručne</span>');
    const kamLine = c ? '<div class="meta">KAM v retieringu: ' + esc(c.k || 'servis (bez KAM)') + '</div>' : '';
    const byLine = g ? '<div class="meta">Zapísal ' + esc(g.zapisal || '–') + ', ' + fmtTs(g.zapisane) + '</div>' : '';
    $('#clientBox').innerHTML = '<div class="nm">'+esc(c ? c.n : (g ? g.organizator : ''))+'</div><div class="meta">'+meta.join('<span aria-hidden="true">·</span>')+'</div>'+kamLine+byLine;
  }
  const prev = f.mode === 'client' ? giftsFor(f.key) : [];
  $('#existsMsg').hidden = !prev.length;
  if(prev.length) $('#existsMsg').textContent = 'Pre tohto klienta už ' + (prev.length === 1 ? 'je zapísaný 1 darček' : 'sú zapísané ' + prev.length + ' darčeky') + ': ' +
    prev.map(x => (DL[x.dovod] ? DL[x.dovod].l : '–') + ' (' + (SL[x.stav] ? SL[x.stav].l.toLowerCase() : '') + ', zapísal ' + (x.zapisal || '–') + ')').join('; ') + '.';
}
function renderTabs(){
  $('#tabP').setAttribute('aria-selected', String(S.tab === 'p'));
  $('#tabG').setAttribute('aria-selected', String(S.tab === 'g'));
  $('#panelP').hidden = S.tab !== 'p'; $('#panelG').hidden = S.tab !== 'g';
  $('#cntG').textContent = S.loaded ? S.items.length : '';
  let n = 0; const me = myName(); if(me) CMAP.forEach(c => { if(c.k === me) n++; });
  $('#cntP').textContent = S.baseLoaded && me && S.me !== ADMIN_ID ? n : '';
}
function renderPortfolio(){
  const wrap = $('#pWrap');
  if(S.baseErr && !S.base.length){
    wrap.innerHTML = '<div class="empty"><p>'+esc(S.baseErr)+'</p><p><button class="btn small" id="retryBase">Skúsiť znova</button></p></div>';
    $('#pFoot').innerHTML = ''; $('#pTitle').textContent = ''; return;
  }
  if(!S.baseLoaded){ wrap.innerHTML = '<div class="empty"><p>Načítavam klientov z retieringu…</p></div>'; $('#pFoot').innerHTML = ''; $('#pTitle').textContent = ''; return; }
  const me = myName();
  let scope = S.pscope;
  if(scope === 'me' && (S.me === ADMIN_ID || !me)) scope = 'all';
  const q = norm(S.pq), list = [];
  CMAP.forEach(c => {
    if(scope === 'me' && c.k !== me) return;
    if(scope === 'servis' && c.k) return;
    if(S.ptier && c.t !== S.ptier) return;
    if(q && (norm(c.n) + ' ' + c.v).indexOf(q) === -1) return;
    list.push(c);
  });
  list.sort((a,b) => TL[b.t].r - TL[a.t].r || b.g - a.g || collator.compare(a.n, b.n));
  const cnt = list.length + ' ' + plural(list.length,'klient','klienti','klientov');
  $('#pTitle').innerHTML = scope === 'me' ? 'Portfólio: <b>'+esc(me)+'</b> · '+cnt : scope === 'servis' ? '<b>Servisní klienti</b> · '+cnt : '<b>Všetci klienti</b> · '+cnt;
  const ed = canEdit();
  if(!list.length){
    wrap.innerHTML = '<div class="empty"><p>'+(q || S.ptier ? 'Filtru nezodpovedá žiadny klient.' : 'V tomto portfóliu zatiaľ nie je žiadny klient.')+'</p>' +
      (scope !== 'all' ? '<p><button class="btn link" data-scope="all">Hľadať vo všetkých klientoch</button></p>' : '') +
      (ed ? '<p><button class="btn small" data-new="1">+ Nový organizátor</button></p>' : '') + '</div>';
    $('#pFoot').innerHTML = ''; return;
  }
  const counts = {}; S.items.forEach(g => { counts[g.klient] = (counts[g.klient] || 0) + g.pocet; });
  const shown = list.slice(0, S.plimit);
  let h = '<table><thead><tr><th scope="col">Organizátor</th><th scope="col">Tier</th><th scope="col">Platforma</th>'+(scope !== 'me' ? '<th scope="col">KAM</th>' : '')+'<th scope="col" class="num">GMV</th><th scope="col">Darčeky</th><th scope="col" aria-label="Akcie"></th></tr></thead><tbody>';
  shown.forEach(c => {
    const n = counts[c.key] || 0, picked = S.form && S.form.mode === 'client' && S.form.key === c.key;
    h += '<tr'+(picked ? ' class="picked"' : '')+'>' +
      '<td class="org">'+esc(c.n)+(c.v ? '<small>IČO '+esc(c.v)+'</small>' : '')+(c.extra ? '<small>pridaný ručne</small>' : '')+'</td>' +
      '<td>'+tierTag(c.t)+'</td>' +
      '<td class="plain">'+esc(c.p || '–')+'</td>' +
      (scope !== 'me' ? '<td class="plain">'+esc(c.k || 'servis')+'</td>' : '') +
      '<td class="num plain">'+fmtGmv(c.g)+'</td>' +
      '<td>'+(n ? '<span class="has">✓ '+n+' ks</span>' : '<span class="plain">–</span>')+'</td>' +
      '<td class="ops">'+(ed ? '<button class="btn small'+(n ? '' : ' primary')+'" data-add="'+esc(c.key)+'">'+(n ? 'Pridať ďalší' : 'Pridať darček')+'</button>' : '')+'</td>' +
      '</tr>';
  });
  wrap.innerHTML = h + '</tbody></table>';
  let foot = '';
  if(list.length > shown.length) foot += '<span>Zobrazených '+shown.length+' z '+list.length+'. Spresni hľadanie alebo</span><button class="btn small" id="more">zobraziť ďalších</button>';
  if(ed) foot += '<button class="btn small" data-new="1">+ Nový organizátor</button>';
  if(isAdmin() && S.mode === 'live') foot += '<button class="btn small" id="reloadBase">Načítať retiering nanovo</button>';
  $('#pFoot').innerHTML = foot;
}
function filteredGifts(){
  const q = norm(S.gq);
  const key = x => x.termin || '9999';
  return S.items
    .filter(x => !S.gkam || (S.gkam === '__mine' ? x.mine : x.kam === S.gkam))
    .filter(x => !S.gdovod || x.dovod === S.gdovod)
    .filter(x => !S.gstav || (S.gstav === 'late' ? isLate(x) : x.stav === S.gstav))
    .filter(x => !q || norm(x.organizator + ' ' + x.kam + ' ' + x.poznamka + ' ' + x.zapisal).indexOf(q) !== -1)
    .sort((a,b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : collator.compare(a.organizator, b.organizator));
}
function renderGifts(){
  const wrap = $('#gWrap');
  $('#exportBtn').hidden = !S.items.length;
  $('#gTitle').textContent = '';
  if(!S.loaded){ wrap.innerHTML = '<div class="empty"><p>'+(S.err ? esc(S.err) : 'Načítavam darčeky…')+'</p></div>'; $('#gFoot').textContent = ''; return; }
  if(!S.items.length){ wrap.innerHTML = '<div class="empty"><p>Zatiaľ tu nie je žiadny darček. Pridaj prvý z portfólia.</p></div>'; $('#gFoot').textContent = ''; return; }
  const rows = filteredGifts();
  if(!rows.length){ wrap.innerHTML = '<div class="empty"><p>Filtru nezodpovedá žiadny darček.</p></div>'; $('#gFoot').textContent = ''; return; }
  let h = '<table><thead><tr><th scope="col">Organizátor</th><th scope="col">Tier</th><th scope="col">KAM</th><th scope="col">Dôvod</th><th scope="col" class="num">Počet</th><th scope="col">Stav</th><th scope="col">Termín</th><th scope="col">Poznámka</th><th scope="col">Zapísal</th><th scope="col" aria-label="Akcie"></th></tr></thead><tbody>';
  rows.forEach(x => {
    const d = DL[x.dovod], s = SL[x.stav], late = isLate(x);
    const changed = x.upravene && x.upravene - x.zapisane > 60000;
    const whoTitle = 'Zapísal: ' + (x.zapisal || '–') + ', ' + fmtTs(x.zapisane) + (changed ? '\nNaposledy upravil: ' + (x.upravil || '–') + ', ' + fmtTs(x.upravene) : '');
    h += '<tr'+(S.form && S.form.id === x.id ? ' class="editing"' : '')+'>' +
      '<td class="org">'+esc(x.organizator)+'</td>' +
      '<td>'+tierTag(x.tier)+'</td>' +
      '<td class="plain">'+esc(x.kam || '–')+'</td>' +
      '<td>'+(d ? '<span class="tag dv-'+x.dovod+'">'+d.l+'</span>' : '<span class="plain">–</span>')+'</td>' +
      '<td class="num">'+x.pocet+'</td>' +
      '<td>'+(s ? '<span class="tag st-'+x.stav+'">'+s.l+'</span>' : '–')+'</td>' +
      '<td class="plain'+(late ? ' late' : '')+'">'+(x.termin ? fmtDate(x.termin) + (late ? ' · po termíne' : '') : '–')+'</td>' +
      '<td class="note-cell">'+(x.poznamka ? esc(x.poznamka) : '–')+'</td>' +
      '<td class="who-cell" title="'+esc(whoTitle)+'"><b>'+esc(x.zapisal || '–')+'</b> · '+fmtShort(x.zapisane)+(changed ? '<br>upravil '+esc(x.upravil || '–')+' · '+fmtShort(x.upravene) : '')+'</td>' +
      '<td class="ops">'+(canTouch(x) ? '<button class="btn small" data-edit="'+esc(x.id)+'">Upraviť</button><button class="btn small danger" data-del="'+esc(x.id)+'">Odstrániť</button>' : '')+'</td>' +
      '</tr>';
  });
  const sum = rows.reduce((a, x) => a + x.pocet, 0);
  h += '</tbody><tfoot><tr><th scope="row" colspan="4">Spolu</th><td class="num"><b>'+sum+'</b></td><td colspan="5"></td></tr></tfoot></table>';
  wrap.innerHTML = h;
  const notes = [];
  if(rows.length !== S.items.length) notes.push('Zobrazených ' + rows.length + ' z ' + S.items.length + ' záznamov.');
  if(!isAdmin() && S.items.some(x => !x.mine)) notes.push('Upraviť a odstrániť môžeš darčeky, ktoré si zapísal ty. Ostatné zmení správca.');
  $('#gFoot').textContent = notes.join(' ');
}

/* ---------- export ---------- */
function exportCsv(){
  const cell = v => '"' + String(v).replace(/"/g,'""') + '"';
  const lines = [['Organizátor','IČO','Tier','KAM / kontakt u nás','Dôvod darčeku','Počet','Stav','Termín','Poznámka','Zapísal','Zapísané','Naposledy upravil','Upravené'].map(cell).join(';')];
  filteredGifts().forEach(x => lines.push([x.organizator, x.ico, TL[x.tier] ? TL[x.tier].l : '', x.kam, DL[x.dovod] ? DL[x.dovod].l : '', x.pocet,
    SL[x.stav] ? SL[x.stav].l : '', fmtDate(x.termin), x.poznamka, x.zapisal, fmtTs(x.zapisane), x.upravil, fmtTs(x.upravene)].map(cell).join(';')));
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url; a.download = 'darceky-organizatori.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- udalosti ---------- */
$('#pickList').addEventListener('click', e => { const b = e.target.closest('[data-me]'); if(b) chooseMe(b.dataset.me); });
$('#changeMe').addEventListener('click', () => startPick());
$('#tabP').addEventListener('click', () => { S.tab = 'p'; renderTabs(); });
$('#tabG').addEventListener('click', () => { S.tab = 'g'; renderTabs(); renderGifts(); });
$('#pQ').addEventListener('input', e => { S.pq = e.target.value; S.plimit = 120; renderPortfolio(); });
$('#pTier').addEventListener('change', e => { S.ptier = e.target.value; renderPortfolio(); });
$('#pScope').addEventListener('change', e => { S.pscope = e.target.value; S.plimit = 120; renderPortfolio(); });
$('#panelP').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  if(b.dataset.add) openClient(b.dataset.add);
  else if(b.dataset.new){ const q = S.pq.trim(); openNew(q && !/^\d+$/.test(q) ? q : ''); }
  else if(b.dataset.scope){ S.pscope = b.dataset.scope; $('#pScope').value = S.pscope; renderPortfolio(); }
  else if(b.id === 'more'){ S.plimit += 200; renderPortfolio(); }
  else if(b.id === 'retryBase') loadClients(false);
  else if(b.id === 'reloadBase') loadClients(true);
});
$('#newOrgBtn').addEventListener('click', () => openNew(''));
$('#submit').addEventListener('click', submit);
$('#cancelForm').addEventListener('click', closeForm);
$('#form').addEventListener('change', e => {
  const fs = e.target.closest('fieldset'); if(fs) fs.classList.remove('fieldset-bad');
  if(e.target.name === 'dovod'){ syncNoteReq(); if(e.target.value !== 'fix'){ $('#fNote').setAttribute('aria-invalid','false'); $('#fNoteWrap').classList.remove('field-bad'); } }
  if(e.target.id === 'fKam' && e.target.value){ e.target.setAttribute('aria-invalid','false'); $('#fKamWrap').classList.remove('field-bad'); }
});
$('#form').addEventListener('input', e => {
  if(e.target.getAttribute('aria-invalid') === 'true' && e.target.value.trim()){ e.target.setAttribute('aria-invalid','false'); const w = e.target.closest('.field'); if(w) w.classList.remove('field-bad'); }
});
['fOrg','fIco','fPocet'].forEach(id => $('#'+id).addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); submit(); } }));
function bump(n){ const el = $('#fPocet'); el.value = String(Math.max(1, Math.min(999, toCount(el.value) + n))); el.setAttribute('aria-invalid','false'); $('#fPocetWrap').classList.remove('field-bad'); }
$('#pMinus').addEventListener('click', () => bump(-1));
$('#pPlus').addEventListener('click', () => bump(1));
$('#gQ').addEventListener('input', e => { S.gq = e.target.value; renderGifts(); });
$('#gKam').addEventListener('change', e => { S.gkam = e.target.value; renderGifts(); });
$('#gStav').addEventListener('change', e => { S.gstav = e.target.value; renderGifts(); });
$('#gDovod').addEventListener('change', e => { S.gdovod = e.target.value; renderGifts(); });
$('#exportBtn').addEventListener('click', exportCsv);
$('#gWrap').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  if(b.dataset.edit) openEdit(b.dataset.edit);
  else if(b.dataset.del){
    const it = S.items.find(x => x.id === b.dataset.del); if(!canTouch(it)) return;
    delId = it.id;
    $('#delText').textContent = it.organizator + ': ' + (DL[it.dovod] ? DL[it.dovod].l : '–') + ', ' + it.pocet + ' ks, KAM ' + (it.kam || '–');
    const d = $('#delDlg'); if(typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open','');
  }
});
$('#delNo').addEventListener('click', () => $('#delDlg').close());
$('#delYes').addEventListener('click', () => { const id = delId; delId = null; $('#delDlg').close(); if(id) remove(id); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && S.mode === 'live' && Date.now() - S.lastOk > 15000) refresh(); });

let toastT = 0;
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4200);
}

/* ---------- štart ---------- */
if(!CFG.apiUrl) startLocal();
else { $('#logout').hidden = false; start(); }
})();
