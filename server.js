const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    // Capture raw body for webhook HMAC verification
    req.rawBody = buf;
  }
}));

/*
======================================================
ENVIRONMENT
======================================================
*/

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseAdmin = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/*
======================================================
HELPERS
======================================================
*/

function makeGLFAccountId() {
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `GLF${Date.now()}${randomPart}`;
}

function numberValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/*
======================================================
ROOT / HEALTH
======================================================
*/

app.get("/", (req, res) => {
  return res.json({
    success: true,
    service: "GLF",
    message: "GLF Backend Active",
    account_system: "Active",
  });
});

/*
======================================================
CREATE GLF ACCOUNT
======================================================
*/

app.post("/api/glf/account/create", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    const fullName = String(req.body.full_name || "").trim();
    const mobile = String(req.body.mobile || "").trim();

    if (!fullName) {
      return res.status(400).json({ success: false, error: "Full name required" });
    }
    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ success: false, error: "Valid 10-digit mobile number required" });
    }

    const { data: existingAccount, error: existingError } = await supabaseAdmin
      .from("glf_accounts").select("*").eq("mobile", mobile).maybeSingle();

    if (existingError) {
      console.error("Existing account lookup error:", existingError);
      return res.status(500).json({ success: false, error: "Account lookup failed" });
    }

    if (existingAccount) {
      return res.json({
        success: true,
        existing: true,
        account_id: existingAccount.account_id,
        id: existingAccount.id,
        message: "GLF account already exists",
      });
    }

    const accountId = makeGLFAccountId();

    const { data: account, error: createError } = await supabaseAdmin
      .from("glf_accounts")
      .insert({
        account_id: accountId,
        full_name: fullName,
        mobile: mobile,
        status: "ACTIVE",
      })
      .select("*").single();

    if (createError) {
      console.error("GLF account creation error:", createError);
      return res.status(500).json({
        success: false,
        error: "Account creation failed",
        details: createError.message,
      });
    }

    return res.json({
      success: true,
      existing: false,
      account_id: account.account_id,
      id: account.id,
      message: "GLF account created",
    });
  } catch (error) {
    console.error("GLF account create error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/*
======================================================
GET GLF ACCOUNT
======================================================
*/

app.get("/api/glf/account/:account_id", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    const accountId = String(req.params.account_id || "").trim();
    if (!accountId) {
      return res.status(400).json({ success: false, error: "Account ID required" });
    }

    const { data, error } = await supabaseAdmin
      .from("glf_accounts").select("*").eq("account_id", accountId).maybeSingle();

    if (error) {
      console.error("Account fetch error:", error);
      return res.status(500).json({ success: false, error: "Account fetch failed" });
    }
    if (!data) {
      return res.status(404).json({ success: false, error: "GLF account not found" });
    }

    return res.json({ success: true, account: data });
  } catch (error) {
    console.error("GLF account error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/*
======================================================
ACCOUNT BALANCE (derived from ledger)
======================================================
*/

app.get("/api/glf/account/:account_id/balance", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    const accountId = String(req.params.account_id || "").trim();
    if (!accountId) {
      return res.status(400).json({ success: false, error: "Account ID required" });
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("glf_accounts")
      .select("account_id, full_name, mobile, status")
      .eq("account_id", accountId).maybeSingle();

    if (accountError) {
      console.error("Balance account lookup error:", accountError);
      return res.status(500).json({ success: false, error: "Account lookup failed" });
    }
    if (!account) {
      return res.status(404).json({ success: false, error: "GLF account not found" });
    }

    const { data: ledger, error: ledgerError } = await supabaseAdmin
      .from("glf_ledger")
      .select("id, account_id, amount, type, status, created_at")
      .eq("account_id", accountId)
      .eq("status", "VERIFIED");

    if (ledgerError) {
      console.error("Balance ledger error:", ledgerError);
      return res.status(500).json({
        success: false,
        error: "Balance calculation failed",
        details: ledgerError.message,
      });
    }

    let balance = 0;
    for (const transaction of ledger || []) {
      const amount = numberValue(transaction.amount);
      const type = String(transaction.type || "").toUpperCase();
      if (type === "CREDIT" || type === "DEPOSIT") balance += amount;
      if (type === "DEBIT" || type === "WITHDRAWAL") balance -= amount;
    }

    return res.json({
      success: true,
      account_id: accountId,
      balance: Number(balance.toFixed(2)),
      currency: "INR",
    });
  } catch (error) {
    console.error("Balance error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/*
======================================================
TRANSACTION HISTORY
======================================================
*/

app.get("/api/glf/account/:account_id/transactions", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    const accountId = String(req.params.account_id || "").trim();
    if (!accountId) {
      return res.status(400).json({ success: false, error: "Account ID required" });
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("glf_accounts")
      .select("account_id, full_name, mobile, status, created_at")
      .eq("account_id", accountId).maybeSingle();

    if (accountError) {
      console.error("Account lookup error:", accountError);
      return res.status(500).json({ success: false, error: "Account lookup failed" });
    }
    if (!account) {
      return res.status(404).json({ success: false, error: "GLF account not found" });
    }

    const { data: transactions, error: ledgerError } = await supabaseAdmin
      .from("glf_ledger")
      .select("id, account_id, amount, type, status, utr_number, user_name, created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (ledgerError) {
      console.error("GLF ledger error:", ledgerError);
      return res.status(500).json({
        success: false,
        error: "Transaction history fetch failed",
        details: ledgerError.message,
      });
    }

    return res.json({
      success: true,
      account: account,
      transactions: transactions || [],
    });
  } catch (error) {
    console.error("Transaction history error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/*
======================================================
⭐ CREATE RAZORPAY ORDER — frontend calls this
Balance lo PENDING maatrame, ledger lo raayadu.
======================================================
*/

app.post("/api/glf/payment/order", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    const accountId = String(req.body.account_id || "").trim();
    const amountRupees = Number(req.body.amount);

    if (!accountId) {
      return res.status(400).json({ success: false, error: "account_id required" });
    }
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return res.status(400).json({ success: false, error: "invalid amount" });
    }
    if (amountRupees > 100000) {
      return res.status(400).json({ success: false, error: "amount exceeds limit" });
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("glf_accounts")
      .select("account_id, full_name")
      .eq("account_id", accountId).maybeSingle();

    if (accountError) {
      return res.status(500).json({ success: false, error: "Account lookup failed" });
    }
    if (!account) {
      return res.status(404).json({ success: false, error: "GLF account not found" });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const amountPaise = Math.round(amountRupees * 100);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `glf_${Date.now()}`,
      notes: {
        account_id: account.account_id,
        user_name: account.full_name,
      },
    });

    // ⭐ No ledger entry yet. Only webhook will write.
    return res.json({
      success: true,
      order_id: order.id,
      amount: amountRupees,
      amount_paise: amountPaise,
      currency: "INR",
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Order create error:", err);
    return res.status(500).json({ success: false, error: "order creation failed" });
  }
});

/*
======================================================
⭐ RAZORPAY WEBHOOK — ONLY place that writes VERIFIED credits
======================================================
*/

app.post("/razorpay-webhook", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).send("supabase not configured");
    }

    const signature = req.headers["x-razorpay-signature"];
    const eventId = req.headers["x-razorpay-event-id"] || null;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !webhookSecret || !req.rawBody) {
      return res.status(400).send("missing signature");
    }

    // 1. HMAC-SHA256 over RAW body
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.rawBody)
      .digest("hex");

    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.warn("⚠️ Webhook signature mismatch");
      return res.status(400).send("bad signature");
    }

    const event = JSON.parse(req.rawBody.toString());
    const eventType = event.event;

    // 2. Idempotency key
    const dedupeKey =
      eventId ||
      `${eventType}:${event?.payload?.payment?.entity?.id || Date.now()}`;

    const { data: existing } = await supabaseAdmin
      .from("glf_webhook_events")
      .select("id")
      .eq("provider_event_id", dedupeKey)
      .maybeSingle();

    if (existing) {
      return res.json({ ok: true, duplicate: true });
    }

    // 3. payment.captured → REAL money arrived
    if (eventType === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (payment) {
        const amountRupees = Number(payment.amount) / 100;
        const notesAccountId = payment.notes?.account_id;
        const notesUserName = payment.notes?.user_name;

        if (notesAccountId) {
          const { data: account } = await supabaseAdmin
            .from("glf_accounts")
            .select("account_id, full_name")
            .eq("account_id", notesAccountId)
            .maybeSingle();

          if (account) {
            await supabaseAdmin.from("glf_ledger").insert({
              account_id: account.account_id,
              amount: amountRupees,
              type: "CREDIT",
              status: "VERIFIED",
              utr_number: payment.id,
              user_name: notesUserName || account.full_name,
            });
          }
        }
      }
    }

    // 4. Record event so retries never double-apply
    await supabaseAdmin.from("glf_webhook_events").insert({
      provider: "razorpay",
      provider_event_id: dedupeKey,
      payload: event,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    // Return 200 so Razorpay doesn't retry forever on bugs
    return res.status(200).json({ ok: false, error: err.message });
  }
});

/*
======================================================
ASSISTANCE REQUEST
======================================================
*/

app.post("/api/assistance/request", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    const accountId = String(req.body.account_id || "").trim();
    const userName = String(req.body.user_name || "").trim();
    const utrNumber = String(req.body.utr_number || "").trim();
    const amount = numberValue(req.body.amount);

    if (!accountId) {
      return res.status(400).json({ success: false, error: "Account ID required" });
    }
    if (amount <= 0) {
      return res.status(400).json({ success: false, error: "Valid amount required" });
    }
    if (!utrNumber) {
      return res.status(400).json({ success: false, error: "UTR number required" });
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("glf_accounts")
      .select("account_id, full_name")
      .eq("account_id", accountId)
      .maybeSingle();

    if (accountError) {
      return res.status(500).json({ success: false, error: "Account lookup failed" });
    }
    if (!account) {
      return res.status(404).json({ success: false, error: "GLF account not found" });
    }

    const { data, error } = await supabaseAdmin
      .from("glf_assistance_requests")
      .insert({
        account_id: accountId,
        amount: amount,
        utr_number: utrNumber,
        user_name: userName || account.full_name || "",
        status: "PENDING",
      })
      .select("*").single();

    if (error) {
      console.error("Assistance request error:", error);
      return res.status(500).json({
        success: false,
        error: "Assistance request failed",
        details: error.message,
      });
    }

    return res.json({
      success: true,
      request: data,
      message: "Assistance request submitted for verification",
    });
  } catch (error) {
    console.error("Assistance error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/*
======================================================
⚠️ VERIFY ASSISTANCE REQUEST — ADMIN ONLY
Requires header: x-admin-secret: <ADMIN_SECRET>
======================================================
*/

app.post("/api/assistance/verify", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    // ⭐ ADMIN AUTH — only admin can verify
    const adminSecret = req.headers["x-admin-secret"];
    if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ success: false, error: "forbidden" });
    }

    const requestId = String(req.body.request_id || "").trim();
    if (!requestId) {
      return res.status(400).json({ success: false, error: "Request ID required" });
    }

    const { data: request, error: requestError } = await supabaseAdmin
      .from("glf_assistance_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) {
      return res.status(500).json({ success: false, error: "Request lookup failed" });
    }
    if (!request) {
      return res.status(404).json({ success: false, error: "Assistance request not found" });
    }

    if (String(request.status || "").toUpperCase() === "VERIFIED") {
      return res.json({ success: true, message: "Request already verified" });
    }

    const { error: updateError } = await supabaseAdmin
      .from("glf_assistance_requests")
      .update({ status: "VERIFIED" })
      .eq("id", requestId);

    if (updateError) {
      console.error("Assistance verification update error:", updateError);
      return res.status(500).json({ success: false, error: "Request verification failed" });
    }

    const { data: ledgerEntry, error: ledgerError } = await supabaseAdmin
      .from("glf_ledger")
      .insert({
        request_id: request.id,
        account_id: request.account_id,
        utr_number: request.utr_number,
        amount: request.amount,
        type: "CREDIT",
        status: "VERIFIED",
        user_name: request.user_name,
      })
      .select("*").single();

    if (ledgerError) {
      console.error("Ledger credit error:", ledgerError);
      return res.status(500).json({
        success: false,
        error: "Request verified but ledger entry failed",
        details: ledgerError.message,
      });
    }

    return res.json({
      success: true,
      message: "Payment verified and ledger updated",
      ledger: ledgerEntry,
    });
  } catch (error) {
    console.error("Assistance verification error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/*
======================================================
WITHDRAWAL REQUEST
======================================================
*/

app.post("/api/withdrawal/request", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: "Supabase admin client not configured" });
    }

    const accountId = String(req.body.account_id || "").trim();
    const userName = String(req.body.user_name || "").trim();
    const amount = numberValue(req.body.amount);

    if (!accountId) {
      return res.status(400).json({ success: false, error: "Account ID required" });
    }
    if (amount <= 0) {
      return res.status(400).json({ success: false, error: "Valid amount required" });
    }

    const { data: ledger, error: ledgerError } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount, type, status")
      .eq("account_id", accountId)
      .eq("status", "VERIFIED");

    if (ledgerError) {
      return res.status(500).json({ success: false, error: "Balance check failed" });
    }

    let balance = 0;
    for (const transaction of ledger || []) {
      const transactionAmount = numberValue(transaction.amount);
      const type = String(transaction.type || "").toUpperCase();
      if (type === "CREDIT" || type === "DEPOSIT") balance += transactionAmount;
      if (type === "DEBIT" || type === "WITHDRAWAL") balance -= transactionAmount;
    }

    if (amount > balance) {
      return res.status(400).json({
        success: false,
        error: "Insufficient available balance",
        balance: Number(balance.toFixed(2)),
      });
    }

    const { data, error } = await supabaseAdmin
      .from("glf_ledger")
      .insert({
        account_id: accountId,
        amount: amount,
        type: "DEBIT",
        status: "PENDING",
        user_name: userName,
      })
      .select("*").single();

    if (error) {
      console.error("Withdrawal ledger error:", error);
      return res.status(500).json({
        success: false,
        error: "Withdrawal request failed",
        details: error.message,
      });
    }

    return res.json({
      success: true,
      message: "Withdrawal request submitted",
      withdrawal: data,
      current_balance: Number(balance.toFixed(2)),
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/*
======================================================
VERCEL
======================================================
*/

module.exports = app;