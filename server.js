const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const memStore = {};
async function redisGet(k){ if(!process.env.UPSTASH_REDIS_REST_URL) return memStore[k]||null; try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(k)}`; const r=await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); const d=await r.json(); return d.result?JSON.parse(d.result):null; }catch{ return memStore[k]||null; } }
async function redisSet(k,v){ if(!process.env.UPSTASH_REDIS_REST_URL){ memStore[k]=v; return; } try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(k)}/${encodeURIComponent(JSON.stringify(v))}`; await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); }catch{ memStore[k]=v; } }
async function redisDel(k){ if(!process.env.UPSTASH_REDIS_REST_URL){ delete memStore[k]; return; } try{ const u=`${process.env.UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(k)}`; await fetch(u,{headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`}}); delete memStore[k]; }catch{ delete memStore[k]; } }

const VIDEO_URL = "https://files.catbox.moe/p078vg.mp4";

app.get("/", (req,res)=> res.send("Backend LIVE ✅ One-Time Access"));

app.get("/api/content", (req,res)=> res.json({
  title: "Informational Fruit Video - Full Video ₹20",
  price: 20,
  upi_id: process.env.UPI_ID || "YOUR_UPI@okaxis"
}));

// VERIFY UTR -> ONE TIME TOKEN
app.post("/api/verify-payment", async (req,res)=>{
  try{
    const ref = (req.body.utr || "").toString().trim();
    if(!/^[0-9]{12}$/.test(ref)){
      return res.json({ success:false, msg:"Invalid Reference Number\nPlease complete the payment and enter the valid UPI transaction reference number." });
    }
    const existing = await redisGet(`utr_${ref}`);
    if(existing){
      return res.json({ success:false, msg:"This Reference Number Has Already Been Used." });
    }
    // One-time token - no expiry, only one-time use
    const token = "tok_"+crypto.randomBytes(10).toString("hex");
    await redisSet(`utr_${ref}`, { token, used: true, createdAt: Date.now() });
    await redisSet(`token_${token}`, { utr: ref, used: false });
    return res.json({ success:true, token, msg:"Payment Verified ✓ — Access Granted" });
  }catch(e){
    return res.status(500).json({ success:false, msg:"Please try again." });
  }
});

// UNLOCK - ONE TIME ONLY, THEN DELETE
app.post("/api/unlock-video", async (req,res)=>{
  try{
    const {token} = req.body;
    if(!token) return res.json({ success:false, msg:"Please pay ₹20 to watch." });
    const data = await redisGet(`token_${token}`);
    if(!data) return res.json({ success:false, msg:"Please pay ₹20 to watch. Token expired or already used." });
    if(data.used) {
      await redisDel(`token_${token}`);
      return res.json({ success:false, msg:"This video access has already been used. Please pay again for one more view." });
    }
    // Mark as used and delete immediately after first unlock - ONE TIME ONLY
    await redisDel(`token_${token}`);
    // Keep UTR as used forever - never allow reuse
    res.json({ success:true, video: VIDEO_URL, oneTime: true });
  }catch(e){ res.status(500).json({ success:false, msg:"Unable to unlock." }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log(`Live ✅ One-Time Flow on port ${PORT}`));