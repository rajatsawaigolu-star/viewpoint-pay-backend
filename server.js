const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

if(!process.env.RAZORPAY_KEY_ID ||!process.env.RAZORPAY_KEY_SECRET){
  console.error("RAZORPAY KEYS missing!");
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// --- Simple Redis via Upstash REST (free) ---
// Render env lo UPSTASH_URL + UPSTASH_TOKEN pedithe durable, lekapothe memory (dev kosam)
let memStore = {};
async function redisGet(key){
  if(!process.env.UPSTASH_REDIS_REST_URL) return memStore[key]||null;
  const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  });
  const d = await r.json(); return d.result? JSON.parse(d.result) : null;
}
async function redisSet(key, val){
  if(!process.env.UPSTASH_REDIS_REST_URL){ memStore[key]=val; return; }
  await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${key}/${encodeURIComponent(JSON.stringify(val))}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  });
}

let siteData = {
  title: "Smart Cute Boy - Full Video ₹20",
  price: 20,
  banner: "https://files.catbox.moe/2bo2hk.jpg",
  // video URL ikkada ivvam - protected
};

const VIDEO_URL = "https://files.catbox.moe/p078vg.mp4";

app.get('/', (req,res)=>res.send('Backend LIVE ✅ Option B'));
app.get('/api/content', (req,res)=>res.json(siteData));

app.post('/api/create-order', async (req,res)=>{
  try{
    const order = await razorpay.orders.create({ amount: 20*100, currency:"INR", receipt:"scb_"+Date.now() });
    res.json({ order_id: order.id, amount: order.amount, key_id: process.env.RAZORPAY_KEY_ID });
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/verify-payment', async (req,res)=>{
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if(!razorpay_order_id ||!razorpay_payment_id ||!razorpay_signature) return res.json({success:false});

  const sign = razorpay_order_id+"|"+razorpay_payment_id;
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(sign).digest("hex");
  if(expected!== razorpay_signature) return res.json({success:false, msg:"Invalid signature"});

  try{
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    // Final checks: ₹20, INR, captured, order match
    if(payment.amount!==2000 || payment.currency!=="INR" || payment.status!=="captured" || payment.order_id!==razorpay_order_id){
      return res.json({success:false, msg:"Payment check failed"});
    }
    const exists = await redisGet(`pay_${razorpay_payment_id}`);
    if(exists?.used) return res.json({success:false, msg:"Already used"});

    const token = "tok_"+crypto.randomBytes(10).toString("hex");
    await redisSet(`pay_${razorpay_payment_id}`, {used:false, token, time:Date.now()});
    await redisSet(`token_${token}`, {payment_id:razorpay_payment_id, used:false});

    res.json({success:true, token});
  }catch(e){ res.status(500).json({success:false, error:e.message}); }
});

app.post('/api/unlock-video', async (req,res)=>{
  const { token } = req.body;
  const data = await redisGet(`token_${token}`);
  if(!data || data.used) return res.json({success:false, msg:"Invalid or used"});

  await redisSet(`token_${token}`, {...data, used:true});
  await redisSet(`pay_${data.payment_id}`, {used:true, time:Date.now()});

  res.json({success:true, video: VIDEO_URL});
});

app.listen(process.env.PORT||10000, ()=>console.log("Live ✅"));