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
    const readStreamBody = async () => {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      return Buffer.concat(chunks).toString("utf8") || "{}";
    };

    let body = req.body;
    if (body && typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (err) {
        return send(400, { ok: false, code: "BAD_JSON", hint: "Body must be JSON with content-type: application/json", details: String(err) });
      }
    } else if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString("utf8"));
      } catch (err) {
        return send(400, { ok: false, code: "BAD_JSON", hint: "Body must be JSON", details: String(err) });
      }
    } else if (!body || typeof body !== "object") {
      try {
        body = JSON.parse(await readStreamBody());
      } catch (err) {
        return send(400, { ok: false, code: "BAD_JSON", hint: "Body must be JSON with content-type: application/json", details: String(err) });
      }
    }

    let { groupId, userId, roleId } = body || {};
    groupId = Number(groupId);
    userId = Number(userId);
    roleId = Number(roleId);
    const isValidId = (value) => Number.isInteger(value) && value > 0;
    if (![groupId, userId, roleId].every(isValidId)) {
      return send(400, { ok: false, code: "MISSING_FIELDS", hint: "Provide numeric groupId, userId, roleId" });
    }

    const safeJson = (text) => {
      try {
        return JSON.parse(text || "{}");
      } catch (err) {
        return { raw: text, parseError: String(err) };
      }
    };

    const doFetch = async (url, method, payload) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const headers = { "x-api-key": key };
      const init = { method, headers, signal: ctrl.signal };

      if (payload !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(payload);
      }

      try {
        const resp = await fetch(url, init);
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, statusText: resp.statusText, url, method, body: safeJson(text) };
      } catch (err) {
        const statusText = err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
        return { ok: false, status: 0, statusText, url, method, error: String(err) };
      } finally {
        clearTimeout(timer);
      }
    };

    const attempts = [
      { where: "cloudV2-PATCH", url: `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`, method: "PATCH", payload: undefined },
      { where: "cloudV2-POST",  url: `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`, method: "POST",  payload: {} },
      { where: "groupsV1-PATCH", url: `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`,                         method: "PATCH", payload: { roleId } },
      { where: "groupsV1-POST",  url: `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`,                         method: "POST",  payload: { roleId } },
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
      attempts: results.map((r) => ({
        where: r.where,
        status: r.status,
        statusText: r.statusText,
        url: r.url,
        error: r.error,
        body: r.body,
      })),
    });
  } catch (err) {
    console.error("[RankRelay] Unhandled error:", err);
    return send(500, { ok: false, code: "UNHANDLED", details: String(err && err.stack ? err.stack : err) });
  }
}
