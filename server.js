const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());

// 1. WEBHOOK - express.json() కంటే ముందు ఉండాలి
app.post('/razorpay-webhook', express.raw({type: 'application/json'}), (req, res) => {
const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
if(!secret) return res.json({status:'ok'});

const signature = req.headers['x-razorpay-signature'];
const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');

if (signature === expected) {
const payload = JSON.parse(req.body.toString());
console.log('✅ Webhook Verified:', payload.event);
res.json({ status: 'ok' });
} else {
console.log('❌ Webhook sign fail');
res.status(400).json({ status: 'invalid' });
}
});

app.use(express.json());

const razorpay = new Razorpay({
key_id: process.env.RAZORPAY_KEY_ID,
key_secret: process.env.RAZORPAY_KEY_SECRET
});

let memStore = {};
async function redisGet(key){
if(!process.env.UPSTASH_REDIS_REST_URL) return memStore[key]||null;
try{
const r = await fetch(${process.env.UPSTASH_REDIS_REST_URL}/get/${key}, {
headers: { Authorization: Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN} }
});
const d = await r.json(); return d.result? JSON.parse(d.result) : null;
}catch{ return memStore[key]||null; }
}
async function redisSet(key, val){
if(!process.env.UPSTASH_REDIS_REST_URL){ memStore[key]=val; return; }
try{
await fetch(${process.env.UPSTASH_REDIS_REST_URL}/set/${key}/${encodeURIComponent(JSON.stringify(val))}, {
headers: { Authorization: Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN} }
});
}catch{ memStore[key]=val; }
}

const VIDEO_URL = "https://files.catbox.moe/p078vg.mp4";

app.get('/', (req,res)=>res.send('Backend LIVE ✅ 24h Access'));
app.get('/api/content', (req,res)=>res.json({ title: "Smart Cute Boy - Full Video ₹20", price: 20, banner: "https://files.catbox.moe/2bo2hk.jpg" }));

app.post('/api/create-order', async (req,res)=>{
try{
const order = await razorpay.orders.create({ amount: 2000, currency:"INR", receipt:"scb_"+Date.now() });
res.json({ order_id: order.id, amount: order.amount, key_id: process.env.RAZORPAY_KEY_ID });
}catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/verify-payment', async (req,res)=>{
const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
if(!razorpay_order_id ||!razorpay_payment_id ||!razorpay_signature) return res.json({success:false, msg:"Please try again."});

const sign = razorpay_order_id+"|"+razorpay_payment_id;
const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(sign).digest("hex");
if(expected!== razorpay_signature) return res.json({success:false, msg:"Please try again."});

try{
const payment = await razorpay.payments.fetch(razorpay_payment_id);
if(payment.amount!==2000 || payment.currency!=="INR" || payment.status!=="captured" || payment.order_id!==razorpay_order_id){
return res.json({success:false, msg:"Please try again."});
}

const exists = await redisGet(`pay_${razorpay_payment_id}`);  
if(exists?.token){  
  return res.json({success:true, token: exists.token, msg:"Welcome to your video!"});  
}  

const token = "tok_"+crypto.randomBytes(10).toString("hex");  
const expiresAt = Date.now() + 24*60*60*1000; // 24 గంటలు payment time నుంచి  

await redisSet(`pay_${razorpay_payment_id}`, {token, expiresAt});  
await redisSet(`token_${token}`, {payment_id:razorpay_payment_id, expiresAt});  

res.json({success:true, token, msg:"Welcome to your video!"});

}catch(e){ res.status(500).json({success:false, msg:"Please try again."}); }
});

app.post('/api/unlock-video', async (req,res)=>{
const { token } = req.body;
const data = await redisGet(token_${token});
if(!data) return res.json({success:false, msg:"Please pay ₹20 to watch"});

if(Date.now() > data.expiresAt){
return res.json({success:false, msg:"24 hours expired. Please pay ₹20 again."});
}

// used:true లేదు - 24h లోపు refresh చేసినా మళ్లీ వస్తుంది
res.json({success:true, video: VIDEO_URL, expiresAt: data.expiresAt});
});

app.listen(process.env.PORT||10000, ()=>console.log("Live ✅ 24h"));