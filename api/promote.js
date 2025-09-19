// /api/promote.js — Vercel serverless function for Roblox rank changes
// POST JSON: { "groupId": number, "userId": number, "roleId": number }

export default async function handler(req, res) {
  try {
    // 1) Method gate
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    // 2) Env var
    const key = process.env.OPEN_CLOUD_KEY;
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return res.status(500).json({ ok: false, error: 'OPEN_CLOUD_KEY missing' });
    }

    // 3) Body parsing (works whether Vercel gave us req.body or a raw stream)
    let payload = {};
    if (req.body && typeof req.body === 'object') {
      payload = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      try {
        payload = JSON.parse(raw);
      } catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
      }
    }

    const { groupId, userId, roleId } = payload || {};
    if (!Number(groupId) || !Number(userId) || !Number(roleId)) {
      return res.status(400).json({ ok: false, error: 'Missing groupId/userId/roleId' });
    }

    // helper to call an endpoint and return normalized result
    const safeJson = (t) => { try { return JSON.parse(t || '{}'); } catch { return { raw: t }; } };
    async function call(url, method, body) {
      const resp = await fetch(url, {
        method,
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : '{}'
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, body: safeJson(text) };
    }

    // A) Open Cloud v2: PATCH /cloud/v2/groups/:groupId/users/:userId/roles/:roleId
    const urlA = `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`;
    let r = await call(urlA, 'PATCH');

    // If v2 fails, B) Groups v1: PATCH /v1/groups/:groupId/users/:userId   { roleId }
    if (!r.ok) {
      const urlB = `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`;
      r = await call(urlB, 'PATCH', { roleId: Number(roleId) });
      if (!r.ok) {
        return res.status(r.status || 500).json({ ok: false, status: r.status, body: r.body });
      }
      return res.json({ ok: true, where: 'groupsV1', status: r.status });
    }

    return res.json({ ok: true, where: 'cloudV2', status: r.status });

  } catch (err) {
    // Last-resort catch so Vercel never shows "FUNCTION_INVOCATION_FAILED"
    return res.status(500).json({ ok: false, error: 'Unhandled', detail: String(err) });
  }
}
