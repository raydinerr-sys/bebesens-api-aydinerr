// api/sor.js — minimal, güvenli sürüm
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, provider: "none" });
  }

  if (req.method === "POST") {
    try {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
      const prompt = String(body.prompt || "").trim();
      return res.status(200).json({ provider: "none", echo: prompt });
    } catch (e) {
      return res.status(400).json({ error: "bad_json", detail: String(e?.message || e) });
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
};
