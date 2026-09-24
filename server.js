// ======================================================
// GLF ACCOUNT TRANSACTION HISTORY
// ======================================================

app.get(
  "/api/glf/account/:account_id/transactions",
  async (req, res) => {
    try {
      if (!supabaseAdmin) {
        return res.status(500).json({
          success: false,
          error: "Supabase admin client not configured",
        });
      }

      const accountId = String(
        req.params.account_id || ""
      ).trim();

      if (!accountId) {
        return res.status(400).json({
          success: false,
          error: "Account ID required",
        });
      }

      // --------------------------------------------------
      // Check whether GLF account exists
      // --------------------------------------------------

      const { data: account, error: accountError } =
        await supabaseAdmin
          .from("glf_accounts")
          .select("*")
          .eq("account_id", accountId)
          .maybeSingle();

      if (accountError) {
        console.error(
          "GLF account lookup error:",
          accountError
        );

        return res.status(500).json({
          success: false,
          error: "Account lookup failed",
        });
      }

      if (!account) {
        return res.status(404).json({
          success: false,
          error: "GLF account not found",
        });
      }

      // --------------------------------------------------
      // Get account transactions
      // --------------------------------------------------

      const { data: transactions, error: ledgerError } =
        await supabaseAdmin
          .from("glf_ledger")
          .select(
            "id, account_id, amount, type, status, utr_number, user_name, created_at"
          )
          .eq("account_id", accountId)
          .order("created_at", {
            ascending: false,
          });

      if (ledgerError) {
        console.error(
          "GLF ledger error:",
          ledgerError
        );

        return res.status(500).json({
          success: false,
          error: "Transaction history fetch failed",
        });
      }

      // --------------------------------------------------
      // Return GLF account + transaction history
      // --------------------------------------------------

      return res.json({
        success: true,

        account: {
          account_id: account.account_id,
          full_name:
            account.full_name ||
            account.user_name ||
            "",
          mobile: account.mobile || "",
          status: account.status || "ACTIVE",
          created_at: account.created_at || null,
        },

        transactions: transactions || [],
      });

    } catch (error) {
      console.error(
        "GLF transaction history error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }
);