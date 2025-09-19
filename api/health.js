export default function handler(req, res) {
  const send = (code, payload) => {
    res.status(code);
    if (payload !== undefined) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    } else {
      res.end();
    }
  };

  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS");
  res.setHeader("cache-control", "no-store");

  if (req.method === "OPTIONS") {
    return send(204);
  }

  if (req.method === "HEAD") {
    return send(200);
  }

  if (req.method !== "GET") {
    res.setHeader("allow", "GET, HEAD, OPTIONS");
    return send(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  return send(200, { ok: true, env: Boolean(process.env.OPEN_CLOUD_KEY) });
}
