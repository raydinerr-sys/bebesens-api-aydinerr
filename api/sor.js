// api/sor.js — TEMİZ & ÇÖKMEZ SÜRÜM
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/sor", ts: Date.now() });
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
      const prompt = String(body.prompt || "").trim();
      const lang = String(body.lang || "tr");
      return res.status(200).json({ ok: true, provider: "none", lang, echo: prompt });
    } catch (e) {
      return res.status(400).json({ ok: false, error: "bad_json", detail: String(e) });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
};