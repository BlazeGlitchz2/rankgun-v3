export default function handler(req, res) {
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  res.status(200);
  res.end(
    JSON.stringify({
      ok: true,
      env: Boolean(process.env.OPEN_CLOUD_KEY),
    })
  );
}
