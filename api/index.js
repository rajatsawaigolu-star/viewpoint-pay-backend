const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // raw body for webhook HMAC
  }
}));

/* =====================================================
   ENV
   ===================================================== */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/* =====================================================
   HELPERS
   ===================================================== */
function makeGLFAccountId() {
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `GLF${Date.now()}${randomPart}`;
}

/* =====================================================
   HEALTH
   ===================================================== */
app.get("/", (req, res) => {
  return res.json({
    success: true,
    service: "GLF",
    message: "GLF Backend Active",
    account_system: "Active"
  });
});

/* =====================================================
   CREATE GLF ACCOUNT
   ===================================================== */
app.post("/api/glf/account/create", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    const fullName = String(req.body.full_name || "").trim();
    const mobile = String(req.body.mobile || "").trim();

    if (!fullName) return res.status(400).json({ success: false, error: "Full name required" });
    if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ success: false, error: "Valid 10-digit mobile required" });

    const { data: existing } = await supabaseAdmin
      .from("glf_accounts").select("*").eq("mobile", mobile).maybeSingle();

    if (existing) {
      return res.json({
        success: true, existing: true,
        account_id: existing.account_id,
        id: existing.id,
        message: "GLF account already exists"
      });
    }

    const accountId = makeGLFAccountId();

    const { data: account, error } = await supabaseAdmin
      .from("glf_accounts")
      .insert({
        account_id: accountId,
        full_name: fullName,
        mobile: mobile,
        status: "ACTIVE"
      })
      .select("*").single();

    if (error) {
      console.error("Account create error:", error);
      return res.status(500).json({ success: false, error: "Account creation failed", details: error.message });
    }

    return res.json({
      success: true, existing: false,
      account_id: account.account_id,
      id: account.id,
      message: "GLF account created"
    });
  } catch (err) {
    console.error("Account create error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* =====================================================
   GET GLF ACCOUNT
   ===================================================== */
app.get("/api/glf/account/:account_id", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    const accountId = String(req.params.account_id || "").trim();
    if (!accountId) return res.status(400).json({ success: false, error: "Account ID required" });

    const { data, error } = await supabaseAdmin
      .from("glf_accounts").select("*").eq("account_id", accountId).maybeSingle();

    if (error) return res.status(500).json({ success: false, error: "Account fetch failed" });
    if (!data) return res.status(404).json({ success: false, error: "GLF account not found" });

    return res.json({ success: true, account: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* =====================================================
   BALANCE (derived, in paise, returned as rupees)
   ===================================================== */
app.get("/api/glf/account/:account_id/balance", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    const accountId = String(req.params.account_id || "").trim();
    if (!accountId) return res.status(400).json({ success: false, error: "Account ID required" });

    const { data: account } = await supabaseAdmin
      .from("glf_accounts").select("account_id, full_name, mobile, status")
      .eq("account_id", accountId).maybeSingle();

    if (!account) return res.status(404).json({ success: false, error: "GLF account not found" });

    const { data: ledger, error: ledgerError } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount_paise, transaction_type, status")
      .eq("account_id", accountId)
      .eq("status", "VERIFIED");

    if (ledgerError) {
      return res.status(500).json({ success: false, error: "Balance calculation failed", details: ledgerError.message });
    }

    let balancePaise = 0;
    for (const tx of ledger || []) {
      const amt = Number(tx.amount_paise) || 0;
      const type = String(tx.transaction_type || "").toUpperCase();
      if (type === "CREDIT" || type === "DEPOSIT") balancePaise += amt;
      if (type === "DEBIT" || type === "WITHDRAWAL") balancePaise -= amt;
    }

    return res.json({
      success: true,
      account_id: accountId,
      balance_paise: balancePaise,
      balance_rupees: Number((balancePaise / 100).toFixed(2)),
      currency: "INR"
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* =====================================================
   TRANSACTIONS
   ===================================================== */
app.get("/api/glf/account/:account_id/transactions", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    const accountId = String(req.params.account_id || "").trim();
    if (!accountId) return res.status(400).json({ success: false, error: "Account ID required" });

    const { data: account } = await supabaseAdmin
      .from("glf_accounts").select("account_id, full_name, mobile, status, created_at")
      .eq("account_id", accountId).maybeSingle();

    if (!account) return res.status(404).json({ success: false, error: "GLF account not found" });

    const { data: transactions, error } = await supabaseAdmin
      .from("glf_ledger")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ success: false, error: "Fetch failed", details: error.message });

    return res.json({ success: true, account, transactions: transactions || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* =====================================================
   ⭐ CREATE RAZORPAY ORDER — frontend calls this
   ===================================================== */
app.post("/api/glf/payment/order", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase not configured" });
    }

    const accountId = String(req.body.account_id || "").trim();
    const amountRupees = Number(req.body.amount);

    if (!accountId) return res.status(400).json({ success: false, error: "account_id required" });
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return res.status(400).json({ success: false, error: "invalid amount" });
    }
    if (amountRupees > 100000) return res.status(400).json({ success: false, error: "amount exceeds limit" });

    const { data: account } = await supabaseAdmin
      .from("glf_accounts").select("account_id, full_name")
      .eq("account_id", accountId).maybeSingle();

    if (!account) return res.status(404).json({ success: false, error: "GLF account not found" });

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const amountPaise = Math.round(amountRupees * 100);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `glf_${Date.now()}`,
      notes: {
        account_id: account.account_id,
        user_name: account.full_name
      }
    });

    // ⭐ No ledger entry. Only webhook writes.
    return res.json({
      success: true,
      order_id: order.id,
      amount: amountRupees,
      amount_paise: amountPaise,
      currency: "INR",
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error("Order create error:", err);
    return res.status(500).json({ success: false, error: "order creation failed", details: err.message });
  }
});

/* =====================================================
   ⭐ RAZORPAY WEBHOOK — only source of VERIFIED credits
   ===================================================== */
app.post("/razorpay-webhook", async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).send("supabase not configured");

    const signature = req.headers["x-razorpay-signature"];
    const eventId = req.headers["x-razorpay-event-id"] || null;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !webhookSecret || !req.rawBody) {
      return res.status(400).send("missing signature");
    }

    const expected = crypto.createHmac("sha256", webhookSecret).update(req.rawBody).digest("hex");
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.warn("⚠️ Webhook signature mismatch");
      return res.status(400).send("bad signature");
    }

    const event = JSON.parse(req.rawBody.toString());
    const eventType = event.event;
    const dedupeKey = eventId || `${eventType}:${event?.payload?.payment?.entity?.id || Date.now()}`;

    const { data: existing } = await supabaseAdmin
      .from("glf_webhook_events").select("id").eq("provider_event_id", dedupeKey).maybeSingle();

    if (existing) return res.json({ ok: true, duplicate: true });

    if (eventType === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (payment) {
        const notesAccountId = payment.notes?.account_id;
        const notesUserName = payment.notes?.user_name;

        if (notesAccountId) {
          const { data: account } = await supabaseAdmin
            .from("glf_accounts").select("account_id, full_name")
            .eq("account_id", notesAccountId).maybeSingle();

          if (account) {
            const { error: insErr } = await supabaseAdmin
              .from("glf_ledger")
              .insert({
                account_id: account.account_id,
                user_name: notesUserName || account.full_name,
                transaction_type: "CREDIT",
                amount_paise: Number(payment.amount),   // ⭐ Razorpay sends paise
                currency: "INR",
                payment_provider: "razorpay",
                provider_order_id: payment.order_id,
                provider_payment_id: payment.id,
                status: "VERIFIED",
                description: `Payment captured — ${payment.id}`
              });

            if (insErr) {
              console.error("Ledger insert error:", insErr);
            }
          }
        }
      }
    }

    await supabaseAdmin.from("glf_webhook_events").insert({
      provider: "razorpay",
      provider_event_id: dedupeKey,
      payload: event
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
});

/* =====================================================
   VERCEL
   ===================================================== */

/* =====================================================
   DEBUG ENV (temporary)
   ===================================================== */
app.get("/debug/env", async (req, res) => {
  const url = process.env.SUPABASE_URL || "NOT_SET";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "NOT_SET";

  let dbTest = "not_attempted";
  let rowCount = 0;
  let dbError = null;

  try {
    const { data, error, count } = await supabaseAdmin
      .from("glf_accounts")
      .select("*", { count: "exact" });
    if (error) {
      dbError = error.message;
      dbTest = "error";
    } else {
      dbTest = "success";
      rowCount = count || (data ? data.length : 0);
    }
  } catch (e) {
    dbError = e.message;
    dbTest = "exception";
  }

  return res.json({
    supabase_url: url,
    url_has_correct_project: url.includes("zgsugeblboajysasffwi"),
    service_key_first_20: key === "NOT_SET" ? "NOT_SET" : key.slice(0, 20),
    service_key_length: key.length,
    service_key_looks_like_jwt: key.startsWith("eyJ"),
    db_query_test: dbTest,
    db_row_count: rowCount,
    db_error: dbError,
  });
});

module.exports = app;
