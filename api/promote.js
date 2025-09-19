// /api/promote.js — Vercel serverless function
// Expects JSON: { groupId: number, userId: number, roleId: number }
// Returns: { ok: true, where: "cloudV2"|"groupsV1", status: number } or { ok:false, … }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const key = process.env.OPEN_CLOUD_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'OPEN_CLOUD_KEY missing' });

  const { groupId, userId, roleId } = req.body || {};
  if (!groupId || !userId || !roleId) {
    return res.status(400).json({ ok: false, error: 'Missing groupId/userId/roleId' });
  }

  // helper to call an endpoint
  async function call(url, method, body) {
    const resp = await fetch(url, {
      method,
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : '{}'
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, body: safeJson(text) };
  }
  const safeJson = (t) => { try { return JSON.parse(t || '{}'); } catch { return { raw:t }; } };

  // A) Open Cloud v2 (role in URL). If this 404/405/403, we’ll fallback.
  const urlA = `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`;
  let r = await call(urlA, 'PATCH');

  if (!r.ok) {
    // B) Groups v1 (roleId in body)
    const urlB = `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`;
    r = await call(urlB, 'PATCH', { roleId });
    if (!r.ok) {
      return res.status(r.status || 500).json({ ok: false, status: r.status, body: r.body });
    }
    return res.json({ ok: true, where: 'groupsV1', status: r.status });
  }

  return res.json({ ok: true, where: 'cloudV2', status: r.status });
}
