const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const razorpay = new Razorpay({
  key_id: "rzp_test_TbZAlloBgol1LS",
  key_secret: "YOUR_KEY_SECRET_HERE" // Razorpay Dashboard nundi secret ikkada pettu
});

app.get('/', (req,res) => res.send('Running OK'));

app.post('/api/create-order', async (req,res) => {
  try {
    const amount = req.body.amount || 10;
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: "vp_" + Date.now()
    });
    res.json(order); // Frontend ki direct order pampali
  } catch(e){
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/verify-payment', (req,res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto.createHmac("sha256", razorpay.key_secret).update(sign).digest("hex");
  if(expectedSign === razorpay_signature){
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Live"));