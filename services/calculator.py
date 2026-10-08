import pandas as pd

def calculate_variances(df_py, df_cy, materiality_threshold, materiality_pct_threshold):
    merged = pd.merge(
        df_py.rename(columns={"balance": "py_balance"}),
        df_cy.rename(columns={"balance": "cy_balance", "account_name": "account_name_cy"}),
        on="account_code",
        how="outer",
    ).fillna({"py_balance": 0.0, "cy_balance": 0.0})

    # Use PY name when available, fall back to CY name for new accounts
    merged["account_name"] = merged["account_name"].fillna(merged.get("account_name_cy", "")).fillna("")
    if "account_name_cy" in merged.columns:
        merged = merged.drop(columns=["account_name_cy"])

    merged["variance_amount"] = merged["cy_balance"] - merged["py_balance"]
    py_nonzero = merged["py_balance"].replace(0, float("nan"))
    merged["variance_pct"] = (merged["variance_amount"] / py_nonzero * 100).round(2)

    abs_var = merged["variance_amount"].abs()
    abs_pct = merged["variance_pct"].abs()

    amt_flagged = abs_var >= materiality_threshold
    pct_flagged = abs_pct >= materiality_pct_threshold

    merged["flagged"] = ((amt_flagged | pct_flagged)).astype(int)
    merged["status"] = merged["flagged"].map({1: "Requires Explanation", 0: "Within Threshold"})
    merged["client_explanation"] = ""

    return merged.to_dict(orient="records")
