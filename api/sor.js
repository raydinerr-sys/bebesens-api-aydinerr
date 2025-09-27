// Basit GET/POST – önce rotayı doğrulayalım
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
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}"): (req.body || {});
    } catch (_) {}
    const prompt = String(body.prompt || "").trim();
    return res.status(200).json({ provider: "none", echo: prompt });
  }

  return res.status(405).json({ error: "method_not_allowed" });
};