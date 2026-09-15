const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
const tokens = new Map();
const pendingPayments = [];
app.get("/", (req, res) => res.send("Viewpoint backend is running"));
app.post("/api/request-access", (req, res) => {
  const {utr} = req.body;
  if(!utr) return res.status(400).json({ok:false});
  const id = Date.now().toString();
  pendingPayments.push({id, utr, time: new Date().toISOString()});
  res.json({ok:true});
});
app.get("/admin/approve/:secret", (req, res) => {
  if(req.params.secret !== process.env.ADMIN_SECRET) return res.status(403).send("No");
  let html = "<h2>Pending</h2>";
  pendingPayments.forEach(p => {
    html += `<p>${p.utr} <a href="/admin/give-token/${process.env.ADMIN_SECRET}/${p.id}">Give</a></p>`;
  });
  res.send(html);
});
app.get("/admin/give-token/:secret/:id", (req, res) => {
  if(req.params.secret !== process.env.ADMIN_SECRET) return res.status(403).send("No");
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, {used:false});
  const link = `${process.env.FRONTEND_URL}?token=${token}`;
  res.send(`<a href="${link}">${link}</a>`);
});
app.get("/api/watch/:token", (req, res) => {
  const d = tokens.get(req.params.token);
  if(!d || d.used) return res.status(403).json({ok:false});
  d.used = true;
  res.json({ok:true, videoUrl: process.env.PRIVATE_VIDEO_URL});
});
app.listen(process.env.PORT || 10000);
