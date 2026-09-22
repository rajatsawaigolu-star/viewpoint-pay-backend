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

  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

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
    account_module: "active",
    ledger: "verified-only"
  });
});

// ======================================================
// CREATE GLF ACCOUNT
// ======================================================

app.post("/api/glf/account/create", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

    const {
      full_name,
      mobile,
      email
    } = req.body;

    if (!full_name || String(full_name).trim().length < 2) {
      return res.status(400).json({
        error: "Valid full name kavali"
      });
    }

    if (!mobile || String(mobile).trim().length < 10) {
      return res.status(400).json({
        error: "Valid mobile number kavali"
      });
    }

    // Generate a unique GLF account ID.
    const accountId =
      "GLF-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    const {
      data,
      error
    } = await supabaseAdmin
      .from("glf_accounts")
      .insert([
        {
          account_id: accountId,
          full_name: String(full_name).trim(),
          mobile: String(mobile).trim(),
          email: email ? String(email).trim() : null,
          status: "ACTIVE"
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      account: data
    });

  } catch (e) {
    console.error("GLF account create error:", e);

    res.status(500).json({
      error: "GLF account creation failed"
    });
  }
});

// ======================================================
// GET GLF ACCOUNT
// ======================================================

app.get("/api/glf/account/:account_id", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

    const accountId = String(req.params.account_id || "").trim();

    if (!accountId) {
      return res.status(400).json({
        error: "Account ID required"
      });
    }

    const {
      data,
      error
    } = await supabaseAdmin
      .from("glf_accounts")
      .select("*")
      .eq("account_id", accountId)
      .single();

    if (error) {
      return res.status(404).json({
        error: "GLF account not found"
      });
    }

    res.json({
      success: true,
      account: data
    });

  } catch (e) {
    console.error("GLF account fetch error:", e);

    res.status(500).json({
      error: "GLF account fetch failed"
    });
  }
});

// ======================================================
// CREATE ASSISTANCE REQUEST
// ======================================================

app.post("/api/assistance/request", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

    const {
      account_id,
      amount,
      utr_number,
      user_name
    } = req.body;

    const numericAmount = Number(amount);

    if (!account_id) {
      return res.status(400).json({
        error: "GLF Account ID kavali"
      });
    }

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

    const {
      data: account,
      error: accountError
    } = await supabaseAdmin
      .from("glf_accounts")
      .select("account_id, full_name, status")
      .eq("account_id", account_id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        error: "GLF account not found"
      });
    }

    if (account.status !== "ACTIVE") {
      return res.status(400).json({
        error: "GLF account is not active"
      });
    }

    const {
      data,
      error
    } = await supabaseAdmin
      .from("glf_assistance_requests")
      .insert([
        {
          account_id: account_id,
          amount: Math.round(numericAmount),
          utr_number: String(utr_number).trim(),
          user_name:
            user_name ||
            account.full_name ||
            "GLF User",
          status: "Pending Verification"
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      status: "Pending Verification",
      data
    });

  } catch (e) {
    console.error("Assistance request error:", e);

    res.status(500).json({
      error: "Assistance request failed"
    });
  }
});

// ======================================================
// ADMIN: LIST ASSISTANCE REQUESTS
// ======================================================

app.get("/api/assistance/list", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

    const {
      data,
      error
    } = await supabaseAdmin
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
        message: "Request ID missing"
      });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({
        message: "Supabase admin client not configured"
      });
    }

    const {
      data: existing,
      error: fetchError
    } = await supabaseAdmin
      .from("glf_assistance_requests")
      .select("*")
      .eq("id", request_id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        message: "Request not found"
      });
    }

    if (existing.status === "Verified") {
      return res.json({
        verified: true,
        status: "Verified",
        message: "Already verified",
        data: existing
      });
    }

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

    if (action !== "verify") {
      return res.status(400).json({
        message: "Invalid verification action"
      });
    }

    const amountToVerify = Number(existing.amount);

    if (
      !Number.isFinite(amountToVerify) ||
      amountToVerify <= 0
    ) {
      return res.status(400).json({
        message: "Invalid payment amount in database"
      });
    }

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

    if (!existingLedger || existingLedger.length === 0) {
      const {
        error: ledgerInsertError
      } = await supabaseAdmin
        .from("glf_ledger")
        .insert([
          {
            request_id: request_id,
            account_id: existing.account_id,
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
// VERIFIED GLF ACCOUNT BALANCE
// ======================================================

app.get("/api/glf/account/:account_id/balance", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

    const accountId = String(req.params.account_id || "").trim();

    if (!accountId) {
      return res.status(400).json({
        error: "Account ID required"
      });
    }

    const {
      data: credits,
      error: creditError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("account_id", accountId)
      .eq("status", "Verified")
      .eq("type", "CREDIT");

    if (creditError) {
      throw creditError;
    }

    const {
      data: debits,
      error: debitError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("account_id", accountId)
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
      success: true,
      account_id: accountId,
      balance,
      total_verified_credits: creditTotal,
      total_verified_debits: debitTotal,
      verified_credit_count: (credits || []).length,
      note:
        "Balance calculated only from verified ledger transactions"
    });

  } catch (e) {
    console.error("Account balance error:", e);

    res.status(500).json({
      error: "Account balance fetch failed"
    });
  }
});

// ======================================================
// GLOBAL VERIFIED BALANCE
// ======================================================

app.get("/api/ledger/balance", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({
        error: "Supabase admin client not configured"
      });
    }

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
      note:
        "Global balance calculated from verified ledger transactions only"
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
      account_id,
      amount,
      destination
    } = req.body;

    const withdrawalAmount = Number(amount);

    if (!account_id) {
      return res.status(400).json({
        message: "GLF Account ID kavali"
      });
    }

    if (
      !Number.isFinite(withdrawalAmount) ||
      withdrawalAmount <= 0
    ) {
      return res.status(400).json({
        message: "Valid withdrawal amount kavali"
      });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({
        message: "Supabase admin client not configured"
      });
    }

    const {
      data: credits,
      error: creditError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("account_id", account_id)
      .eq("status", "Verified")
      .eq("type", "CREDIT");

    if (creditError) {
      throw creditError;
    }

    const {
      data: debits,
      error: debitError
    } = await supabaseAdmin
      .from("glf_ledger")
      .select("amount")
      .eq("account_id", account_id)
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

    if (withdrawalAmount > available) {
      return res.status(400).json({
        message:
          `Insufficient verified balance. Available: ${available}`
      });
    }

    const {
      data: withdrawal,
      error: withdrawalError
    } = await supabaseAdmin
      .from("glf_ledger")
      .insert([
        {
          account_id: account_id,
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
        "Withdrawal request created. Actual payout requires an authorized payment provider.",
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
    `GLF Backend running on ${PORT} - Account + Verified Ledger active`
  );
});