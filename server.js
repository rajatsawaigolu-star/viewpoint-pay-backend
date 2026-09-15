const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
const tokens = new Map();
const pendingPayments = [];
app.get("/", (req, res) => res.send("Viewpoint backend is running"));
app.post("/api/request-access", (req, res) => {
  const { utr } = req.body;
  if (!utr) return res.status(400).json({ ok: false, msg: "UTR required" });
  const id = Date.now().toString();
  pendingPayments.push({ id, utr, time: new Date().toISOString() });
  res.json({ ok: true, msg: "UTR received. Admin approval required." });
});
app.get("/admin/approve/:secret", (req, res) => {
  if (req.params.secret !== process.env.ADMIN_SECRET) return res.status(403).send("No access");
  let html = "<h2>Pending ₹20 Payments</h2>";
  if (pendingPayments.length === 0) html += "<p>No pending.</p>";
  pendingPayments.forEach(p => {
    html += `<p>UTR: ${p.utr}<br>${p.time}<br><a href="/admin/give-token/${process.env.ADMIN_SECRET}/${p.id}">Give Access</a></p><hr>`;
  });
  res.send(html);
});
app.get("/admin/give-token/:secret/:id", (req, res) => {
  if (req.params.secret !== process.env.ADMIN_SECRET) return res.status(403).send("No access");
  const payment = pendingPayments.find(p => p.id === req.params.id);
  if (!payment) return res.status(404).send("Not found");
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { used: false });
  const link = `${process.env.FRONTEND_URL}?token=${token}`;
  res.send(`<h2>Link Created</h2><a href="${link}">${link}</a>`);
});
app.get("/api/watch/:token", (req, res) => {
  const data = tokens.get(req.params.token);
  if (!data || data.used) return res.status(403).json({ ok: false, msg: "Invalid or used" });
  data.used = true;
  res.json({ ok: true, videoUrl: process.env.PRIVATE_VIDEO_URL });
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Running " + PORT));
