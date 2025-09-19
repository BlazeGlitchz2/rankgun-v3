// /api/promote.js — Vercel Serverless Function (Node runtime)
const TIMEOUT_MS = 12000;

export default async function handler(req, res) {
  const send = (code, obj) => {
    res.status(code);
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, x-requested-with");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.end(JSON.stringify(obj ?? {}));
  };

  try {
    if (req.method === "OPTIONS") return send(200, { ok: true });
    if (req.method !== "POST") {
      res.setHeader("allow", "POST, OPTIONS");
      return send(405, { ok: false, code: "METHOD_NOT_ALLOWED", hint: "Use POST with application/json" });
    }

    const key = process.env.OPEN_CLOUD_KEY;
    if (!key || typeof key !== "string" || key.trim() === "") {
      return send(500, { ok: false, code: "MISSING_KEY", hint: "Set OPEN_CLOUD_KEY env var on Vercel Project (Production + Preview)" });
    }

    // Parse body robustly
    let body = req.body;
    if (!body || typeof body !== "object") {
      try {
        const chunks = [];
        for await (const ch of req) chunks.push(ch);
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        body = JSON.parse(raw);
      } catch (e) {
        return send(400, { ok: false, code: "BAD_JSON", hint: "Body must be JSON with content-type: application/json", details: String(e) });
      }
    }

    let { groupId, userId, roleId } = body || {};
    groupId = Number(groupId);
    userId  = Number(userId);
    roleId  = Number(roleId);
    if (!Number.isFinite(groupId) || !Number.isFinite(userId) || !Number.isFinite(roleId)) {
      return send(400, { ok: false, code: "MISSING_FIELDS", hint: "Provide numeric groupId, userId, roleId" });
    }

    const safeJson = (t) => { try { return JSON.parse(t || "{}"); } catch { return { raw: t }; } };
    const doFetch = async (url, method, payload) => {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), TIMEOUT_MS);
      try {
        const resp = await fetch(url, {
          method,
          headers: { "x-api-key": key, "content-type": "application/json" },
          body: payload ? JSON.stringify(payload) : "{}",
          signal: ctrl.signal
        });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, statusText: resp.statusText, url, method, body: safeJson(text) };
      } catch (err) {
        return { ok: false, status: 0, statusText: "NETWORK_ERROR", url, method, error: String(err) };
      } finally {
        clearTimeout(t);
      }
    };

    const attempts = [
      { where: "cloudV2-PATCH", url: `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}`, method: "PATCH", payload: { roleId } },
      { where: "groupsV1-PATCH",url: `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`,                         method: "PATCH", payload: { roleId } },
      { where: "groupsV1-POST", url: `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`,                         method: "POST",  payload: { roleId } },
    ];

    const results = [];
    for (const a of attempts) {
      const r = await doFetch(a.url, a.method, a.payload);
      results.push({ where: a.where, ...r });
      console.log(`[RankRelay] Attempt ${a.where} -> ${r.status} ${r.statusText}`);
      if (r.ok) {
        const where = a.where.startsWith("cloudV2") ? "cloudV2" : "groupsV1";
        return send(200, { ok: true, where, status: r.status });
      }
    }

    return send(502, {
      ok: false,
      code: "ALL_ATTEMPTS_FAILED",
      hint: "Check key scope (groups:read, groups:write, group access), endpoint availability, and that user/group/roleId are valid",
      attempts: results.map(r => ({
        where: r.where, status: r.status, statusText: r.statusText, url: r.url, error: r.error, body: r.body
      }))
    });

  } catch (err) {
    console.error("[RankRelay] Unhandled error:", err);
    return send(500, { ok: false, code: "UNHANDLED", details: String(err && err.stack ? err.stack : err) });
  }
}
