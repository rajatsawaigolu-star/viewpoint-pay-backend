const express = require("express");
const crypto = require("crypto");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// ======================================================
// REDIS
// ======================================================

const memStore = {};

async function redisGet(k) {
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return memStore[k] || null;
  }

  try {
    const u =
      `${process.env.UPSTASH_REDIS_REST_URL}/get/` +
      encodeURIComponent(k);

    const r = await fetch(u, {
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`
      }
    });

    const d = await r.json();

    return d.result ? JSON.parse(d.result) : null;
  } catch {
    return memStore[k] || null;
  }
}

async function redisSet(k, v) {
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    memStore[k] = v;
    return;
  }

  try {
    const u =
      `${process.env.UPSTASH_REDIS_REST_URL}/set/` +
      `${encodeURIComponent(k)}/` +
      `${encodeURIComponent(JSON.stringify(v))}`;

    await fetch(u, {
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`
      }
    });
  } catch {
    memStore[k] = v;
  }
}

async function redisDel(k) {
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    delete memStore[k];
    return;
  }

  try {
    const u =
      `${process.env.UPSTASH_REDIS_REST_URL}/del/` +
      encodeURIComponent(k);

    await fetch(u, {
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`
      }
    });
  } catch {
    delete memStore[k];
  }
}

// ======================================================
// SUPABASE
// ======================================================

let supabase = null;
let supabaseAdmin = null;

try {
  const { createClient } = require("@supabase/supabase-js");

  if (process.env.SUPABASE_URL) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Server-side privileged client
    // SERVICE ROLE KEY must NEVER be put inside App.js/frontend.
    supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
} catch (e) {
  console.log("Supabase not configured yet");
}

// ======================================================
// CONFIG
// ======================================================

const UPI_ID = "pgangadhar444-1@oksbi";

const ADMIN_SECRET =
  process.env.ADMIN_VERIFICATION_SECRET || "change-this-in-env";

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    project: "viewpoint-pay-backend",
    glf_module: "active",
    ledger: "verified-only"
  });
});

// ======================================================
// PAYMENT INFO
// ======================================================

app.get("/api/payment-info", (req, res) => {
  res.json({
    upiId: UPI_ID,
    name: "View Point - GLF",
    note: "Manual Verification Only"
  });
});

// ======================================================
// CREATE ASSISTANCE / PAYMENT REQUEST
// ======================================================

app.post("/api/assistance/request", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        error: "Supabase not connected"
      });
    }

    const {
      amount,
      utr_number,
      user_name
    } = req.body;

    const numericAmount = Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return res.status(400).json({
        error: "Valid amount kavali"
      });
    }

    if (
      !utr_number ||
      String(utr_number).trim().length < 6
    ) {
      return res.status(400).json({
        error: "Valid UTR kavali"
      });
    }

    const { data, error } = await supabase
      .from("glf_assistance_requests")
      .insert([
        {
          amount: Math.round(numericAmount),
          utr_number: String(utr_number).trim(),
          user_name: user_name || "Trial User",
          payment_method: "UPI_QR",
          upi_id_used: UPI_ID,
          status: "Pending Verification"
        }
      ])
      .select();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      status: "Pending Verification",
      data
    });

  } catch (e) {
    console.error("Request error:", e);

    res.status(500).json({
      error: "Request failed"
    });
  }
});

// ======================================================
// ADMIN: LIST REQUESTS
// ======================================================

app.get("/api/assistance/list", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

    const { data, error } = await supabaseAdmin
      .from("glf_assistance_requests")
      .select("*")
      .order("created_at", {
        ascending: false
      });

    if (error) {
      throw error;
    }

    res.json(data || []);

  } catch (e) {
    console.error("List error:", e);

    res.status(500).json({
      error: "List failed"
    });
  }
});

// ======================================================
// ADMIN VERIFICATION
// ======================================================

app.post("/api/assistance/verify", async (req, res) => {
  try {
    const {
      request_id,
      action,
      admin_secret
    } = req.body;

    // --------------------------------------------------
    // ADMIN SECRET CHECK
    // --------------------------------------------------

    if (!admin_secret || !ADMIN_SECRET) {
      return res.status(403).json({
        message: "Admin verification data missing"
      });
    }

    const a = Buffer.from(String(admin_secret));
    const b = Buffer.from(String(ADMIN_SECRET));

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return res.status(403).json({
        message: "Unauthorized"
      });
    }

    if (!request_id) {
      return res.status(400).json({
        message: "Payment verification data missing"
      });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({
        message: "Supabase admin client not configured"
      });
    }

    // --------------------------------------------------
    // GET REQUEST
    // --------------------------------------------------

    const {
      data: existing,
      error: fetchError
    } = await supabaseAdmin
      .from("glf_assistance_requests")
      .select("*")
      .eq("id", request_id)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (!existing) {
      return res.status(404).json({
        message: "Request not found"
      });
    }

    // --------------------------------------------------
    // ALREADY VERIFIED
    // --------------------------------------------------

    if (existing.status === "Verified") {
      return res.json({
        verified: true,
        status: "Verified",
        message: "Already verified",
        data: existing
      });
    }

    // --------------------------------------------------
    // REJECT
    // --------------------------------------------------

    if (action === "reject") {
      const {
        data,
        error
      } = await supabaseAdmin
        .from("glf_assistance_requests")
        .update({
          status: "Rejected",
          verified_amount: null,
          verified_at: null
        })
        .eq("id", request_id)
        .select();

      if (error) {
        throw error;
      }

      return res.json({
        verified: false,
        status: "Rejected",
        data
      });
    }

    // --------------------------------------------------
    // ONLY VERIFY ACTION ALLOWED
    // --------------------------------------------------

    if (action !== "verify") {
      return res.status(400).json({
        message: "Invalid verification action"
      });
    }

    // --------------------------------------------------
    // IMPORTANT:
    // VERIFIED AMOUNT COMES FROM DATABASE REQUEST.
    // CLIENT CANNOT OVERRIDE IT.
    // --------------------------------------------------

    const amountToVerify = Number(existing.amount);

    if (
      !Number.isFinite(amountToVerify) ||
      amountToVerify <= 0
    ) {
      return res.status(400).json({
        message: "Invalid payment amount in database"
      });
    }

    // --------------------------------------------------
    // UPDATE REQUEST
    // --------------------------------------------------

    const {
      data: updated,
      error: updateError
    } = await supabaseAdmin
      .from("glf_assistance_requests")
      .update({
        status: "Verified",
        verified_amount: amountToVerify,
        verified_at: new Date().toISOString()
      })
      .eq("id", request_id)
      .select();

    if (updateError) {
      throw updateError;
    }

    // --------------------------------------------------
    // CHECK EXISTING LEDGER ENTRY
    // Prevent duplicate credit
    // --------------------------------------------------

    const {
      data: existingLedger,
      error: ledgerCheckError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("id")
      .eq("request_id", request_id)
      .eq("type", "CREDIT")
      .limit(1);

    if (ledgerCheckError) {
      throw ledgerCheckError;
    }

    // --------------------------------------------------
    // CREATE CREDIT ONLY ONCE
    // --------------------------------------------------

    if (!existingLedger || existingLedger.length === 0) {
      const {
        error: ledgerInsertError
      } = await supabaseAdmin
        .from("glf_ledger")
        .insert([
          {
            request_id: request_id,
            utr_number: existing.utr_number,
            amount: amountToVerify,
            type: "CREDIT",
            status: "Verified",
            user_name: existing.user_name
          }
        ]);

      if (ledgerInsertError) {
        throw ledgerInsertError;
      }
    }

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    res.json({
      verified: true,
      status: "Verified",
      verified_amount: amountToVerify,
      data: updated
    });

  } catch (e) {
    console.error("Verify error:", e);

    res.status(500).json({
      message: "Verification error - please try again"
    });
  }
});

// ======================================================
// VERIFIED BALANCE
// ======================================================

app.get("/api/ledger/balance", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

    // --------------------------------------------------
    // CREDIT = VERIFIED ONLY
    // --------------------------------------------------

    const {
      data: credits,
      error: creditError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("status", "Verified")
      .eq("type", "CREDIT");

    if (creditError) {
      throw creditError;
    }

    // --------------------------------------------------
    // DEBIT = VERIFIED ONLY
    // --------------------------------------------------

    const {
      data: debits,
      error: debitError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("status", "Verified")
      .eq("type", "DEBIT");

    if (debitError) {
      throw debitError;
    }

    const creditTotal = (credits || []).reduce(
      (sum, row) =>
        sum + (Number(row.amount) || 0),
      0
    );

    const debitTotal = (debits || []).reduce(
      (sum, row) =>
        sum + (Number(row.amount) || 0),
      0
    );

    const balance = creditTotal - debitTotal;

    res.json({
      balance,
      total_verified_credits: creditTotal,
      total_verified_debits: debitTotal,
      verified_credit_count: (credits || []).length,
      note: "Balance calculated from verified ledger transactions only"
    });

  } catch (e) {
    console.error("Balance error:", e);

    res.status(500).json({
      error: "Balance fetch failed"
    });
  }
});

// ======================================================
// WITHDRAWAL REQUEST
// ======================================================

app.post("/api/withdrawal/request", async (req, res) => {
  try {
    const {
      amount,
      destination
    } = req.body;

    const withdrawalAmount = Number(amount);

    if (
      !Number.isFinite(withdrawalAmount) ||
      withdrawalAmount <= 0
    ) {
      return res.status(400).json({
        message: "Valid withdrawal amount kavali"
      });
    }

    if (
      !process.env.PAYOUT_PROVIDER_API_KEY ||
      !process.env.PAYOUT_PROVIDER_URL
    ) {
      return res.status(503).json({
        message:
          "Payment provider not configured. " +
          "Authorized payout provider must be configured separately."
      });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({
        message: "Supabase admin client not configured"
      });
    }

    // --------------------------------------------------
    // VERIFIED CREDITS
    // --------------------------------------------------

    const {
      data: credits,
      error: creditError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("status", "Verified")
      .eq("type", "CREDIT");

    if (creditError) {
      throw creditError;
    }

    // --------------------------------------------------
    // VERIFIED DEBITS
    // --------------------------------------------------

    const {
      data: debits,
      error: debitError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("status", "Verified")
      .eq("type", "DEBIT");

    if (debitError) {
      throw debitError;
    }

    const creditTotal = (credits || []).reduce(
      (sum, row) =>
        sum + (Number(row.amount) || 0),
      0
    );

    const debitTotal = (debits || []).reduce(
      (sum, row) =>
        sum + (Number(row.amount) || 0),
      0
    );

    const available = creditTotal - debitTotal;

    // --------------------------------------------------
    // BALANCE CHECK
    // --------------------------------------------------

    if (withdrawalAmount > available) {
      return res.status(400).json({
        message:
          `Insufficient verified balance. Available: ${available}`
      });
    }

    // --------------------------------------------------
    // IMPORTANT:
    // This creates a pending withdrawal record only.
    // It does NOT create money or a bank account.
    // --------------------------------------------------

    const {
      data: withdrawal,
      error: withdrawalError
    } = await supabaseAdmin
      .from("glf_ledger")
      .insert([
        {
          amount: Math.round(withdrawalAmount),
          type: "DEBIT",
          status: "Pending Verification",
          user_name: destination || "Self Withdrawal",
          utr_number: "WD-" + Date.now()
        }
      ])
      .select();

    if (withdrawalError) {
      throw withdrawalError;
    }

    res.json({
      success: true,
      status: "Pending Verification",
      message:
        "Withdrawal request created. " +
        "Actual payout requires authorized payment provider processing.",
      data: withdrawal
    });

  } catch (e) {
    console.error("Withdrawal error:", e);

    res.status(500).json({
      message: "Withdrawal failed"
    });
  }
});

// ======================================================
// SERVER
// ======================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `GLF Backend running on ${PORT} - Verified-only ledger active`
  );
