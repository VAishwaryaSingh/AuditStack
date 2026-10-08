import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "auditos.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    init_match_tables()
    init_support_reader_tables()
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            materiality_threshold REAL DEFAULT 50000.0,
            materiality_pct_threshold REAL DEFAULT 5.0
        );

        CREATE TABLE IF NOT EXISTS tb_rows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
            account_code TEXT,
            account_name TEXT,
            py_balance REAL DEFAULT 0.0,
            cy_balance REAL DEFAULT 0.0,
            variance_amount REAL GENERATED ALWAYS AS (cy_balance - py_balance) STORED,
            variance_pct REAL,
            status TEXT DEFAULT 'Within Threshold',
            client_explanation TEXT DEFAULT '',
            flagged INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        );
    """)
    conn.commit()
    conn.close()

def init_match_tables():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS match_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS match_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL REFERENCES match_sets(id) ON DELETE CASCADE,
            transaction_id TEXT NOT NULL,
            vendor TEXT DEFAULT '',
            po_vendor TEXT DEFAULT '',
            po_ref TEXT, po_date TEXT, po_line_item TEXT,
            po_qty REAL, po_price REAL, po_buyer TEXT, po_total REAL,
            has_po INTEGER DEFAULT 0,
            grn_vendor TEXT DEFAULT '',
            grn_ref TEXT, grn_date TEXT, grn_line_item TEXT,
            grn_qty REAL, grn_received_by TEXT, grn_total REAL,
            has_grn INTEGER DEFAULT 0,
            inv_vendor TEXT DEFAULT '',
            inv_ref TEXT, inv_date TEXT, inv_line_item TEXT,
            inv_qty REAL, inv_price REAL, inv_due_date TEXT, inv_total REAL,
            has_inv INTEGER DEFAULT 0,
            UNIQUE(set_id, transaction_id)
        );
    """)
    # Migrate existing tables — add per-doc vendor columns if they don't exist yet
    for col in ('po_vendor', 'grn_vendor', 'inv_vendor'):
        try:
            conn.execute(f'ALTER TABLE match_transactions ADD COLUMN {col} TEXT DEFAULT ""')
        except Exception:
            pass  # column already exists
    conn.commit()
    conn.close()


def get_match_sets():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, created_at FROM match_sets ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_match_set(name):
    conn = get_db()
    cur = conn.execute("INSERT INTO match_sets (name) VALUES (?)", (name,))
    sid = cur.lastrowid
    conn.commit()
    conn.close()
    return sid


def delete_match_set(set_id):
    conn = get_db()
    conn.execute("DELETE FROM match_sets WHERE id = ?", (set_id,))
    conn.commit()
    conn.close()


def get_match_transactions(set_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM match_transactions WHERE set_id = ? ORDER BY transaction_id",
        (set_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _safe_float(v):
    try:
        return float(str(v).replace(',', '').replace('$', '').strip())
    except (TypeError, ValueError):
        return 0.0


def upsert_match_po(set_id, txn_id, vendor, ref, date, line_item, qty, price, buyer, total):
    conn = get_db()
    conn.execute("""
        INSERT INTO match_transactions
            (set_id, transaction_id, vendor, po_vendor, po_ref, po_date, po_line_item,
             po_qty, po_price, po_buyer, po_total, has_po)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
        ON CONFLICT(set_id, transaction_id) DO UPDATE SET
            vendor       = CASE WHEN excluded.vendor != '' THEN excluded.vendor ELSE vendor END,
            po_vendor    = excluded.po_vendor,
            po_ref       = excluded.po_ref,   po_date      = excluded.po_date,
            po_line_item = excluded.po_line_item, po_qty   = excluded.po_qty,
            po_price     = excluded.po_price, po_buyer     = excluded.po_buyer,
            po_total     = excluded.po_total, has_po       = 1
    """, (set_id, txn_id, vendor, vendor, ref, date, line_item,
          _safe_float(qty), _safe_float(price), buyer, _safe_float(total)))
    conn.commit()
    conn.close()


def upsert_match_grn(set_id, txn_id, vendor, ref, date, line_item, qty, received_by, total):
    conn = get_db()
    conn.execute("""
        INSERT INTO match_transactions
            (set_id, transaction_id, vendor, grn_vendor, grn_ref, grn_date, grn_line_item,
             grn_qty, grn_received_by, grn_total, has_grn)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)
        ON CONFLICT(set_id, transaction_id) DO UPDATE SET
            vendor          = CASE WHEN excluded.vendor != '' THEN excluded.vendor ELSE vendor END,
            grn_vendor      = excluded.grn_vendor,
            grn_ref         = excluded.grn_ref,  grn_date        = excluded.grn_date,
            grn_line_item   = excluded.grn_line_item, grn_qty    = excluded.grn_qty,
            grn_received_by = excluded.grn_received_by,
            grn_total       = excluded.grn_total, has_grn        = 1
    """, (set_id, txn_id, vendor, vendor, ref, date, line_item,
          _safe_float(qty), received_by, _safe_float(total)))
    conn.commit()
    conn.close()


def upsert_match_invoice(set_id, txn_id, vendor, ref, date, line_item, qty, price, due_date, total):
    conn = get_db()
    conn.execute("""
        INSERT INTO match_transactions
            (set_id, transaction_id, vendor, inv_vendor, inv_ref, inv_date, inv_line_item,
             inv_qty, inv_price, inv_due_date, inv_total, has_inv)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
        ON CONFLICT(set_id, transaction_id) DO UPDATE SET
            vendor        = CASE WHEN excluded.vendor != '' THEN excluded.vendor ELSE vendor END,
            inv_vendor    = excluded.inv_vendor,
            inv_ref       = excluded.inv_ref,  inv_date      = excluded.inv_date,
            inv_line_item = excluded.inv_line_item, inv_qty  = excluded.inv_qty,
            inv_price     = excluded.inv_price, inv_due_date = excluded.inv_due_date,
            inv_total     = excluded.inv_total, has_inv      = 1
    """, (set_id, txn_id, vendor, vendor, ref, date, line_item,
          _safe_float(qty), _safe_float(price), due_date, _safe_float(total)))
    conn.commit()
    conn.close()


def init_support_reader_tables():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS document_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL REFERENCES document_sets(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            doc_type TEXT DEFAULT 'other',
            status TEXT DEFAULT 'pending',
            uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS document_fields (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            field_label TEXT NOT NULL,
            source_label TEXT,
            field_value TEXT,
            is_custom INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS custom_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL REFERENCES document_sets(id) ON DELETE CASCADE,
            field_label TEXT NOT NULL,
            source_label TEXT NOT NULL
        );
    """)
    conn.commit()
    conn.close()

# ── DOCUMENT SET CRUD ────────────────────────────────────────────

def create_doc_set(name):
    conn = get_db()
    cur = conn.execute("INSERT INTO document_sets (name) VALUES (?)", (name,))
    set_id = cur.lastrowid
    conn.commit()
    conn.close()
    return set_id

def get_doc_sets():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, created_at FROM document_sets ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_doc_set(set_id):
    conn = get_db()
    ds = conn.execute("SELECT * FROM document_sets WHERE id = ?", (set_id,)).fetchone()
    if not ds:
        conn.close()
        return None
    docs = conn.execute(
        "SELECT * FROM documents WHERE set_id = ? ORDER BY uploaded_at", (set_id,)
    ).fetchall()
    result_docs = []
    for doc in docs:
        fields = conn.execute(
            "SELECT * FROM document_fields WHERE document_id = ? ORDER BY is_custom, id",
            (doc["id"],)
        ).fetchall()
        result_docs.append({**dict(doc), "fields": [dict(f) for f in fields]})
    mappings = conn.execute(
        "SELECT * FROM custom_mappings WHERE set_id = ?", (set_id,)
    ).fetchall()
    conn.close()
    return {**dict(ds), "documents": result_docs, "custom_mappings": [dict(m) for m in mappings]}

def delete_doc_set(set_id):
    conn = get_db()
    conn.execute("DELETE FROM document_sets WHERE id = ?", (set_id,))
    conn.commit()
    conn.close()

def add_document(set_id, filename, doc_type, status="complete"):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO documents (set_id, filename, doc_type, status) VALUES (?, ?, ?, ?)",
        (set_id, filename, doc_type, status)
    )
    doc_id = cur.lastrowid
    conn.commit()
    conn.close()
    return doc_id

def save_document_fields(document_id, fields):
    conn = get_db()
    conn.execute("DELETE FROM document_fields WHERE document_id = ?", (document_id,))
    conn.executemany(
        "INSERT INTO document_fields (document_id, field_label, source_label, field_value, is_custom) VALUES (?, ?, ?, ?, ?)",
        [(document_id, f["label"], f.get("source_label"), f.get("value"), f.get("is_custom", 0)) for f in fields]
    )
    conn.commit()
    conn.close()

def update_document_field(field_id, value):
    conn = get_db()
    conn.execute("UPDATE document_fields SET field_value = ? WHERE id = ?", (value, field_id))
    conn.commit()
    conn.close()

def update_document_status(document_id, status, doc_type=None):
    conn = get_db()
    if doc_type:
        conn.execute("UPDATE documents SET status = ?, doc_type = ? WHERE id = ?", (status, doc_type, document_id))
    else:
        conn.execute("UPDATE documents SET status = ? WHERE id = ?", (status, document_id))
    conn.commit()
    conn.close()

def save_custom_mappings(set_id, mappings):
    conn = get_db()
    conn.execute("DELETE FROM custom_mappings WHERE set_id = ?", (set_id,))
    conn.executemany(
        "INSERT INTO custom_mappings (set_id, field_label, source_label) VALUES (?, ?, ?)",
        [(set_id, m["field_label"], m["source_label"]) for m in mappings]
    )
    conn.commit()
    conn.close()

def get_document_with_fields(document_id):
    conn = get_db()
    doc = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if not doc:
        conn.close()
        return None
    fields = conn.execute(
        "SELECT * FROM document_fields WHERE document_id = ? ORDER BY is_custom, id",
        (document_id,)
    ).fetchall()
    conn.close()
    return {**dict(doc), "fields": [dict(f) for f in fields]}

# ── MODULE 1 (existing) ──────────────────────────────────────────

def create_session(name, materiality_threshold=50000.0, materiality_pct_threshold=5.0):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO sessions (name, materiality_threshold, materiality_pct_threshold) VALUES (?, ?, ?)",
        (name, materiality_threshold, materiality_pct_threshold)
    )
    session_id = cur.lastrowid
    conn.commit()
    conn.close()
    return session_id

def get_sessions():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, created_at, materiality_threshold, materiality_pct_threshold FROM sessions ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_session(session_id):
    conn = get_db()
    session = conn.execute(
        "SELECT * FROM sessions WHERE id = ?", (session_id,)
    ).fetchone()
    if not session:
        conn.close()
        return None
    rows = conn.execute(
        "SELECT * FROM tb_rows WHERE session_id = ? ORDER BY sort_order, account_code",
        (session_id,)
    ).fetchall()
    conn.close()
    return {**dict(session), "rows": [dict(r) for r in rows]}

def delete_session(session_id):
    conn = get_db()
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()

def upsert_rows(session_id, rows_list):
    conn = get_db()
    conn.execute("DELETE FROM tb_rows WHERE session_id = ?", (session_id,))
    conn.executemany(
        """INSERT INTO tb_rows
           (session_id, account_code, account_name, py_balance, cy_balance,
            variance_pct, status, flagged, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                session_id,
                r["account_code"],
                r["account_name"],
                r["py_balance"],
                r["cy_balance"],
                r.get("variance_pct"),
                r["status"],
                r["flagged"],
                i,
            )
            for i, r in enumerate(rows_list)
        ],
    )
    conn.commit()
    conn.close()

def update_explanation(row_id, text):
    conn = get_db()
    conn.execute(
        "UPDATE tb_rows SET client_explanation = ? WHERE id = ?", (text, row_id)
    )
    conn.commit()
    conn.close()

def update_threshold(session_id, threshold, pct_threshold):
    conn = get_db()
    conn.execute(
        "UPDATE sessions SET materiality_threshold = ?, materiality_pct_threshold = ? WHERE id = ?",
        (threshold, pct_threshold, session_id),
    )
    rows = conn.execute(
        "SELECT id, variance_amount, variance_pct FROM tb_rows WHERE session_id = ?",
        (session_id,)
    ).fetchall()
    for row in rows:
        amt_flagged = abs(row["variance_amount"] or 0) >= threshold
        pct_flagged = abs(row["variance_pct"] or 0) >= pct_threshold
        flagged = 1 if (amt_flagged or pct_flagged) else 0
        status = "Requires Explanation" if flagged else "Within Threshold"
        conn.execute(
            "UPDATE tb_rows SET flagged = ?, status = ? WHERE id = ?",
            (flagged, status, row["id"]),
        )
    conn.commit()
    conn.close()
