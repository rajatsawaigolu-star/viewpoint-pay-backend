const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

app.get('/', (req, res) => {
  res.send('Viewpoint Pay Backend Running ✅');
});

app.post('/api/create-order', async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: 100 * 100,
      currency: 'INR',
      receipt: 'vp_' + Date.now()
    });
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
    if (expected === razorpay_signature) {
      return res.json({ success: true, unlock: true });
    } else {
      return res.status(400).json({ success: false });
    }
  } catch (e) {
    return res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Running ${PORT}`));