// Sprostredkuje dopyty prehľadu darčekov na Google Apps Script.
// Prehliadač nikdy nevidí adresu Apps Scriptu ani tímový kľúč, tie sú len vo Verceli.
//
// Kto čo smie: člen tímu (APP_PASSWORD) pridáva darčeky a upravuje či maže len tie, ktoré sám zapísal.
// Správca (ADMIN_PASSWORD) môže meniť všetky. Kto je kto, určuje meno vybrané po prihlásení
// (obrazovka „Kto si?“), ktoré je podpísané v prihlasovacej cookie a prehliadač ho nemôže podvrhnúť.
import { sessionFromReq } from './_session.js';
import { sendJson, readJsonBody, callGas } from './_http.js';

const READ = new Set(['list', 'clients']);
const WRITE = new Set(['add', 'update', 'delete']);

export default async function handler(req, res) {
  const s = await sessionFromReq(req);
  if (!s) return sendJson(res, 401, {ok: false, error: 'login_required'});
  if (req.method !== 'POST') return sendJson(res, 405, {ok: false, error: 'bad_request'});

  const body = await readJsonBody(req);
  if (!body || (!READ.has(body.action) && !WRITE.has(body.action))) return sendJson(res, 200, {ok: false, error: 'bad_request'});
  if (s.member === '-') return sendJson(res, 200, {ok: false, error: 'identity_required'});

  // Tieto polia nastavuje len server, nikdy prehliadač.
  delete body.key;
  body.role = s.role;
  body.by = s.member;

  const j = await callGas(body);
  if (j && j.ok && j.data && typeof j.data === 'object') { j.data.role = s.role; j.data.me = s.member; }
  return sendJson(res, j && j.status || 200, j || {ok: false, error: 'network'});
}
