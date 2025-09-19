// /api/promote.js — Vercel Serverless Function (Node runtime)
const TIMEOUT_MS = 12000;

const readStreamToString = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseJsonBody = async (req) => {
  let body = req.body;

  try {
    if (body == null) {
      const raw = await readStreamToString(req);
      body = raw.trim() ? JSON.parse(raw) : {};
    } else if (typeof body === "string") {
      body = body.trim() ? JSON.parse(body) : {};
    } else if (Buffer.isBuffer(body)) {
      const raw = body.toString("utf8");
      body = raw.trim() ? JSON.parse(raw) : {};
    }
  } catch (err) {
    throw new Error(`BAD_JSON:${err instanceof Error ? err.message : String(err)}`);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("INVALID_BODY");
  }

  return body;
};

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

    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("BAD_JSON:")) {
        return send(400, {
          ok: false,
          code: "BAD_JSON",
          hint: "Body must be JSON with content-type: application/json",
          details: err.message.slice("BAD_JSON:".length)
        });
      }
      return send(400, {
        ok: false,
        code: "INVALID_BODY",
        hint: "Body must be a JSON object with groupId, userId, roleId"
      });
    }

    const toId = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : NaN;
    };

    const ids = {
      groupId: toId(body.groupId),
      userId: toId(body.userId),
      roleId: toId(body.roleId)
    };

    const invalidFields = Object.entries(ids)
      .filter(([, value]) => !Number.isSafeInteger(value) || value <= 0)
      .map(([name]) => name);

    if (invalidFields.length) {
      return send(400, {
        ok: false,
        code: "MISSING_FIELDS",
        hint: "Provide positive integer groupId, userId, and roleId",
        invalid: invalidFields
      });
    }

    const { groupId, userId, roleId } = ids;

    const safeJson = (t) => {
      try {
        return JSON.parse(t || "{}");
      } catch {
        return { raw: t };
      }
    };

    const doFetch = async (url, method, payload) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const headers = { "x-api-key": key };
        let bodyText;
        if (payload !== undefined) {
          headers["content-type"] = "application/json";
          bodyText = JSON.stringify(payload);
        }

        const resp = await fetch(url, {
          method,
          headers,
          body: bodyText,
          signal: ctrl.signal
        });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, statusText: resp.statusText, url, method, body: safeJson(text) };
      } catch (err) {
        const timedOut = err instanceof Error && err.name === "AbortError";
        return {
          ok: false,
          status: 0,
          statusText: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
          url,
          method,
          error: String(err),
          timedOut
        };
      } finally {
        clearTimeout(t);
      }
    };

    const attempts = [
      { where: "cloudV2-PATCH", url: `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`, method: "PATCH", payload: undefined },
      { where: "cloudV2-POST", url: `https://apis.roblox.com/cloud/v2/groups/${groupId}/users/${userId}/roles/${roleId}`, method: "POST", payload: {} },
      { where: "groupsV1-PATCH", url: `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`, method: "PATCH", payload: { roleId } },
      { where: "groupsV1-POST", url: `https://groups.roblox.com/v1/groups/${groupId}/users/${userId}`, method: "POST", payload: { roleId } }
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
        timedOut: r.timedOut
      }))
    });
  } catch (err) {
    console.error("[RankRelay] Unhandled error:", err);
    return send(500, { ok: false, code: "UNHANDLED", details: String(err && err.stack ? err.stack : err) });
  }
}

