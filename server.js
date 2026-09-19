const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors");

const app = express();

app.use(cors());

// ===============================
// RAZORPAY WEBHOOK
// ===============================
app.post(
  "/razorpay-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Webhook secret not configured
    if (!secret) {
      return res.json({ status: "ok" });
    }

    const signature = req.headers["x-razorpay-signature"];

    const expected = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    if (signature !== expected) {
      console.log("❌ Webhook signature failed");
      return res.status(400).json({ status: "invalid" });
    }

    try {
      const payload = JSON.parse(req.body.toString());
      console.log("✅ Webhook Verified:", payload.event);
      return res.json({ status: "ok" });
    } catch (error) {
      return res.status(400).json({ status: "invalid" });
    }
  }
);

app.use(express.json());

// ===============================
// RAZORPAY
// ===============================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ===============================
// SIMPLE MEMORY STORE
// ===============================
// Works for testing.
// For permanent 24-hour access across server restarts,
// use Redis/database.
const memStore = {};

async function redisGet(key) {
  // Memory mode
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return memStore[key] || null;
  }

  try {
    const url =
      `${process.env.UPSTASH_REDIS_REST_URL}/get/` +
      encodeURIComponent(key);

    const response = await fetch(url, {
      headers: {
        Authorization:
          `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`
      }
    });

    const data = await response.json();

    return data.result ? JSON.parse(data.result) : null;
  } catch (error) {
    console.log("Redis GET failed, using memory store.");
    return memStore[key] || null;
  }
}

async function redisSet(key, value) {
  // Memory mode
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    memStore[key] = value;
    return;
  }

  try {
    const url =
      `${process.env.UPSTASH_REDIS_REST_URL}/set/` +
      encodeURIComponent(key) +
      "/" +
      encodeURIComponent(JSON.stringify(value));

    await fetch(url, {
      headers: {
        Authorization:
          `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`
      }
    });
  } catch (error) {
    console.log("Redis SET failed, using memory store.");
    memStore[key] = value;
  }
}

// ===============================
// VIDEO
// ===============================
const VIDEO_URL =
  "https://files.catbox.moe/p078vg.mp4";

// ===============================
// HOME
// ===============================
app.get("/", (req, res) => {
  res.send("Backend LIVE ✅ 24h Access");
});

// ===============================
// CONTENT
// ===============================
app.get("/api/content", (req, res) => {
  res.json({
    title: "Smart Cute Boy - Full Video ₹20",
    price: 20,
    banner: "https://files.catbox.moe/2bo2hk.jpg"
  });
});

// ===============================
// CREATE RAZORPAY ORDER
// ===============================
app.post("/api/create-order", async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: 2000,
      currency: "INR",
      receipt: "scb_" + Date.now()
    });

    res.json({
      order_id: order.id,
      amount: order.amount,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error("Create order error:", error);

    res.status(500).json({
      error: "Unable to create payment order."
    });
  }
});

// ===============================
// VERIFY PAYMENT
// ===============================
app.post("/api/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.json({
        success: false,
        msg: "Please try again."
      });
    }

    // Verify Razorpay signature
    const sign =
      razorpay_order_id +
      "|" +
      razorpay_payment_id;

    const expected = crypto
      .createHmac(
        "sha256",
        process.env.RAZORPAY_KEY_SECRET
      )
      .update(sign)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.json({
        success: false,
        msg: "Payment verification failed."
      });
    }

    // Confirm payment with Razorpay
    const payment = await razorpay.payments.fetch(
      razorpay_payment_id
    );

    if (
      payment.amount !== 2000 ||
      payment.currency !== "INR" ||
      payment.status !== "captured" ||
      payment.order_id !== razorpay_order_id
    ) {
      return res.json({
        success: false,
        msg: "Payment verification failed."
      });
    }

    // Check whether this payment already has a token
    const existing = await redisGet(
      `pay_${razorpay_payment_id}`
    );

    if (existing && existing.token) {
      return res.json({
        success: true,
        token: existing.token,
        expiresAt: existing.expiresAt,
        msg: "Welcome to your video!"
      });
    }

    // Create new 24-hour token
    const token =
      "tok_" +
      crypto.randomBytes(10).toString("hex");

    const expiresAt =
      Date.now() + 24 * 60 * 60 * 1000;

    // Save payment → token
    await redisSet(
      `pay_${razorpay_payment_id}`,
      {
        token,
        expiresAt
      }
    );

    // Save token → payment
    await redisSet(
      `token_${token}`,
      {
        payment_id: razorpay_payment_id,
        expiresAt
      }
    );

    res.json({
      success: true,
      token,
      expiresAt,
      msg: "Welcome to your video!"
    });

  } catch (error) {
    console.error("Payment verification error:", error);

    res.status(500).json({
      success: false,
      msg: "Please try again."
    });
  }
});

// ===============================
// UNLOCK VIDEO
// ===============================
app.post("/api/unlock-video", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.json({
        success: false,
        msg: "Please pay ₹20 to watch."
      });
    }

    const data = await redisGet(
      `token_${token}`
    );

    if (!data) {
      return res.json({
        success: false,
        msg: "Please pay ₹20 to watch."
      });
    }

    // 24-hour expiry check
    if (Date.now() > data.expiresAt) {
      return res.json({
        success: false,
        msg: "24 hours expired. Please pay ₹20 again."
      });
    }

    // IMPORTANT:
    // No used:true.
    // Token remains valid until expiresAt.
    res.json({
      success: true,
      video: VIDEO_URL,
      expiresAt: data.expiresAt
    });

  } catch (error) {
    console.error("Unlock error:", error);

    res.status(500).json({
      success: false,
      msg: "Unable to unlock video."
    });
  }
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Live ✅ 24h Access on port ${PORT}`);
});