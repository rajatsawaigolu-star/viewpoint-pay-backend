const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let siteData = {
  title: "My Exclusive Video - ₹100",
  price: 10,
  banner: "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=800",
  video: "https://www.youtube.com/embed/dQw4w9WgXcQ"
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

app.get('/', (req,res) => res.send('Backend LIVE ✅'));
app.get('/api/content', (req,res) => res.json(siteData));
app.post('/api/content', (req,res) => { siteData = req.body; res.json({success:true, data:siteData}); });

app.post('/api/create-order', async (req,res) => {
  try {
    const amount = Number(req.body.amount) || 10;
    const order = await razorpay.orders.create({ amount: amount*100, currency:"INR", receipt:"vp_"+Date.now() });
    res.json(order);
  } catch(e){ console.log(e); res.status(500).json({error:e.message}); }
});

app.post('/api/verify-payment', (req,res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const sign = razorpay_order_id+"|"+razorpay_payment_id;
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(sign).digest("hex");
  res.json({success: expected===razorpay_signature});
});

app.listen(process.env.PORT||10000, ()=>console.log("Live"));