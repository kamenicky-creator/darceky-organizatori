// Zoznam tímu pre obrazovku „Kto si?“. Stačí byť prihlásený, meno ešte nemusí byť vybrané.
import { sessionFromReq } from './_session.js';
import { sendJson, callGas } from './_http.js';

export default async function handler(req, res) {
  const s = await sessionFromReq(req);
  if (!s) return sendJson(res, 401, {ok: false, error: 'login_required'});
  if (req.method !== 'GET') return sendJson(res, 405, {ok: false, error: 'bad_request'});
  const j = await callGas({action: 'team'});
  if (!j || !j.ok) return sendJson(res, j && j.status || 200, j || {ok: false, error: 'network'});
  const members = (j.data && Array.isArray(j.data.members) ? j.data.members : [])
    .filter(m => m && m.active !== false)
    .map(m => ({id: m.id, name: m.name, active: true}));
  return sendJson(res, 200, {ok: true, data: {members, role: s.role}});
}
