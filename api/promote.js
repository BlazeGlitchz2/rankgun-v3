// /api/promote.js — Vercel Serverless Function (Node runtime)
// POST JSON: { "groupId": number, "userId": number, "roleId": number }

export default async function handler(req, res) {
  // Helper: send JSON and never throw
  const send = (code, obj) => {
    res.status(code).setHeader('content-type', 'application/json');
    // Allow CORS (useful if you hit this from anywhere else during testing)
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    return res.end(JSON.stringify(obj ?? {}));
  };

  try {
    // 1) Method gate
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return send(405, { ok: false, error: 'Method Not Allowed' });
    }

    // 2) Env var (Open Cloud API key)
    const key = process.env.OPEN_CLOUD_KEY;
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return send(500, { ok: false, error: 'OPEN_CLOUD_KEY missing' });
    }

    // 3) Parse body robustly (works even if body wasn’t auto-parsed)
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try {
        const chunks = [];
        for await (const ch of req) chunks.push(ch);
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        body = JSON.parse(raw);
      } catch {
        return send(400, { ok: false, error: 'Invalid JSON body' });
      }
    }

    let { groupId, userId, roleId } = body || {};
    groupId = Number(groupId);
    userId  = Number(userId);
    roleId  = Number(roleId);

    if (!Number.isFinite(groupId) || !Number.isFinite(userId) || !Number.isFinite(roleId)) {
      return send(400, { ok: false, error: 'Missing or non-numeric groupId/userId/roleId' });
    }

    // 4) Small fetch wrapper with safe JSON
    const safeJson = (t) => { try { return JSON.parse(t || '{}'); } catch { return { raw: t }; } };
    const doFetch = async (url, method, payload) => {
      const resp = await fetch(url, {
        method,
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: payload ? JSON.stringify(payload) : '{}',
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, body: safeJson(text) };
    };

    // 5) Try Cloud v2 (role in URL) → fallback to Groups v1 (roleId in body)
    const urlV2 = `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`;
    let r = await doFetch(urlV2, 'PATCH');

    if (!r.ok) {
      const urlV1 = `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`;
      r = await doFetch(urlV1, 'PATCH', { roleId });
      if (!r.ok) {
        return send(r.status || 500, { ok: false, where: 'groupsV1', status: r.status, body: r.body });
      }
      return send(200, { ok: true, where: 'groupsV1', status: r.status });
    }

    return send(200, { ok: true, where: 'cloudV2', status: r.status });

  } catch (err) {
    // Last-resort catch: never let the function crash
    return res
      .status(500)
      .json({ ok: false, error: 'Unhandled', detail: String(err && err.stack ? err.stack : err) });
  }
}
