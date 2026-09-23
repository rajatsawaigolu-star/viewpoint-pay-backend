// ======================================================
// GLF ACCOUNT TRANSACTION HISTORY
// ======================================================

app.get(
  "/api/glf/account/:account_id/transactions",
  async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(500).json({
          error: "Supabase admin client not configured"
        });
      }

      const accountId = String(
        req.params.account_id || ""
      ).trim();

      if (!accountId) {
        return res.status(400).json({
          error: "Account ID required"
        });
      }

      const { data, error } = await supabaseAdmin
        .from("glf_ledger")
        .select(
          "id, account_id, amount, type, status, utr_number, user_name, created_at"
        )
        .eq("account_id", accountId)
        .order("created_at", {
          ascending: false
        });

      if (error) {
        throw error;
      }

      return res.json({
        success: true,
        account_id: accountId,
        transactions: data || []
      });

    } catch (e) {
      console.error(
        "Transaction history error:",
        e
      );

      return res.status(500).json({
        error: "Transaction history fetch failed"
      });
    }
  }
);