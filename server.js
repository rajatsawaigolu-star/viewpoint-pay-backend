const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Razorpay Instance — Keys Render Environment nundi vastayi
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Health check
app.get('/', (req, res) => {
  res.send('Viewpoint Pay Backend Running ✅');
});

// 1. CREATE ORDER — ₹100
app.post('/api/create-order', async (req, res) => {
  try {
    const options = {
      amount: 100 * 100, // ₹100
      currency: 'INR',
      receipt: 'vp_' + Date.now()
    };
    const order = await razorpay.orders.create(options);
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Order create failed' });
  }
});

// 2. VERIFY PAYMENT — Fake UTR ni aapedhi idi!
app.post('/api/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // ✅ REAL PAYMENT — ippude unlock
      return res.json({ success: true, unlock: true, message: 'Payment verified' });
    } else {
      // ❌ Fake / 123456 / tampered
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});