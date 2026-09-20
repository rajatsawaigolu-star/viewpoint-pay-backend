const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const memStore = {};
async function redisGet(k){ if(!process.env.UPSTASH_REDIS_REST_URL) return memStore[k]||null; try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(k)}`; const r=await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); const d=await r.json(); return d.result?JSON.parse(d.result):null; }catch{ return memStore[k]||null; } }
async function redisSet(k,v){ if(!process.env.UPSTASH_REDIS_REST_URL){ memStore[k]=v; return; } try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(k)}/${encodeURIComponent(JSON.stringify(v))}`; await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); }catch{ memStore[k]=v; } }

const VIDEO_URL = "https://files.catbox.moe/p078vg.mp4";

app.get("/", (req,res)=> res.send("Backend LIVE ✅ QR + UTR + 24h Access"));

app.get("/api/content", (req,res)=> res.json({
  title: "Informational Fruit Video - Full Video ₹20",
  price: 20,
  banner: "https://files.catbox.moe/2bo2hk.jpg",
  upi_id: process.env.UPI_ID || "YOUR_UPI@okaxis",
  upi_name: "Fruit Info"
}));

// NEW QR + UTR VERIFICATION
app.post("/api/verify-payment", async (req,res)=>{
  try{
    const ref = (req.body.utr || req.body.razorpay_payment_id || "").toString().trim();
    if(!/^[0-9]{12}$/.test(ref)){
      return res.json({ success:false, msg:"Invalid Reference Number\nPlease complete the payment and enter the valid UPI transaction reference number." });
    }
    const existing = await redisGet(`utr_${ref}`);
    if(existing){
      return res.json({ success:false, msg:"This Reference Number Has Already Been Used." });
    }
    const token = "tok_"+crypto.randomBytes(10).toString("hex");
    const expiresAt = Date.now()+24*60*60*1000;
    await redisSet(`utr_${ref}`, {token, expiresAt, usedAt:Date.now()});
    await redisSet(`token_${token}`, {utr:ref, expiresAt});
    return res.json({ success:true, token, expiresAt, msg:"Payment Verified ✓ — Access Granted" });
  }catch(e){
    console.error(e);
    return res.status(500).json({ success:false, msg:"Please try again." });
  }
});

app.post("/api/unlock-video", async (req,res)=>{
  try{
    const {token} = req.body;
    if(!token) return res.json({ success:false, msg:"Please pay ₹20 to watch." });
    const data = await redisGet(`token_${token}`);
    if(!data) return res.json({ success:false, msg:"Please pay ₹20 to watch." });
    if(Date.now()>data.expiresAt) return res.json({ success:false, msg:"24 hours expired. Please pay ₹20 again." });
    res.json({ success:true, video:VIDEO_URL, expiresAt:data.expiresAt });
  }catch(e){ res.status(500).json({ success:false, msg:"Unable to unlock video." }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log(`Live ✅ QR Flow on port ${PORT}`));