import io
import pandas as pd

COLUMN_ALIASES = {
    "account_code": ["account code", "acct code", "acct no", "account #", "account no", "code", "gl code", "gl account"],
    "account_name": ["account name", "acct name", "description", "account description", "name"],
    "balance": ["balance", "ending balance", "amount", "closing balance", "end balance", "total"],
}

def _normalize_columns(df):
    mapping = {}
    cols_lower = {c.strip().lower(): c for c in df.columns}
    for target, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in cols_lower:
                mapping[cols_lower[alias]] = target
                break
    if not mapping:
        raise ValueError(
            f"Could not find required columns. Expected Account Code, Account Name, and Balance columns. "
            f"Got: {list(df.columns)}"
        )
    df = df.rename(columns=mapping)
    missing = [k for k in ["account_code", "account_name", "balance"] if k not in df.columns]
    if missing:
        raise ValueError(
            f"Missing required columns: {missing}. "
            f"Please ensure your file has Account Code, Account Name, and Balance columns."
        )
    return df[["account_code", "account_name", "balance"]].copy()

def parse_upload(file_bytes, ext):
    buf = io.BytesIO(file_bytes)
    if ext in ("xlsx", "xls"):
        df = pd.read_excel(buf, engine="openpyxl")
    else:
        try:
            df = pd.read_csv(buf, thousands=",")
        except Exception:
            buf.seek(0)
            df = pd.read_csv(buf, thousands=",", encoding="latin-1")

    df = df.dropna(how="all")
    df = _normalize_columns(df)
    df["account_code"] = df["account_code"].astype(str).str.strip()
    df["account_name"] = df["account_name"].astype(str).str.strip()
    df["balance"] = (
        df["balance"]
        .astype(str)
        .str.replace(r"[\$,\s]", "", regex=True)
        .str.replace(r"^\((.+)\)$", r"-\1", regex=True)
    )
    df["balance"] = pd.to_numeric(df["balance"], errors="coerce").fillna(0.0)
    return df
