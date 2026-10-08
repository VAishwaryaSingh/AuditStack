import re
import io

# ── TEXT EXTRACTION ──────────────────────────────────────────────

def _extract_text_pdf(file_bytes):
    import pdfplumber
    text = ""
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"
    return text.strip()

def _extract_text_image(file_bytes):
    from PIL import Image
    import pytesseract
    img = Image.open(io.BytesIO(file_bytes))
    return pytesseract.image_to_string(img)

def _extract_text_scanned_pdf(file_bytes):
    from pdf2image import convert_from_bytes
    import pytesseract
    pages = convert_from_bytes(file_bytes, dpi=200)
    return "\n".join(pytesseract.image_to_string(p) for p in pages)

def _extract_text_docx(file_bytes):
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

def extract_text(file_bytes, ext):
    if not file_bytes:
        return ""
    ext = ext.lower().lstrip(".")
    if ext == "pdf":
        try:
            text = _extract_text_pdf(file_bytes)
        except Exception:
            text = ""
        if len(text.strip()) < 30:
            try:
                text = _extract_text_scanned_pdf(file_bytes)
            except Exception:
                pass
        return text
    elif ext in ("png", "jpg", "jpeg", "tiff", "bmp"):
        try:
            return _extract_text_image(file_bytes)
        except Exception:
            return ""
    elif ext in ("docx",):
        try:
            return _extract_text_docx(file_bytes)
        except Exception:
            return ""
    return ""

# ── DOCUMENT TYPE DETECTION ──────────────────────────────────────

_TYPE_KEYWORDS = {
    "check": ["pay to the order of", "check no", "check number", "void", "memo", "routing number", "authorized signature"],
    "invoice": ["invoice", "invoice no", "invoice number", "bill to", "ship to", "payment terms", "due date", "purchase order"],
    "agreement": ["agreement", "contract", "whereas", "hereinafter", "parties", "in witness whereof", "governing law", "effective date"],
    "bank_statement": ["account statement", "beginning balance", "ending balance", "deposits", "withdrawals", "bank statement", "account number"],
    "receipt": ["receipt", "thank you for your purchase", "subtotal", "sales tax", "total due", "cash", "credit card", "change"],
}

def detect_doc_type(text):
    lower = text.lower()
    scores = {t: sum(1 for kw in kws if kw in lower) for t, kws in _TYPE_KEYWORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "other"

# ── FIELD EXTRACTION ─────────────────────────────────────────────

_DATE_RE = re.compile(
    r'\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\w+ \d{1,2},? \d{4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b'
)
_AMOUNT_RE = re.compile(r'\$[\s]?[\d,]+(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b')

def _first_date(text):
    m = _DATE_RE.search(text)
    return m.group(0) if m else ""

def _all_amounts(text):
    return _AMOUNT_RE.findall(text)

def _anchor_value(text, *anchors):
    """Find the first line containing any anchor keyword and return the value that comes after it."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        ll = line.lower()
        for anchor in anchors:
            idx = ll.find(anchor.lower())
            if idx != -1:
                # Take only what is AFTER the anchor on the same line
                after = line[idx + len(anchor):].strip(" :-_|")
                if after:
                    return after
                # Anchor is at end of line — try next non-empty line
                for next_line in lines[i + 1:]:
                    stripped = next_line.strip()
                    if stripped:
                        return stripped
    return ""

def _extract_check(text):
    amounts = _all_amounts(text)
    # "PAY TO THE ORDER OF" sometimes spans two lines; join them first
    joined = re.sub(r'PAY TO THE\s*\n\s*ORDER OF', 'PAY TO THE ORDER OF', text, flags=re.IGNORECASE)
    return [
        {"label": "Date",         "value": _first_date(text)},
        {"label": "Payee",        "value": _anchor_value(joined, "pay to the order of", "payee")},
        {"label": "Amount",       "value": amounts[0] if amounts else ""},
        {"label": "Check Number", "value": _anchor_value(text, "check no", "check number", "check #", "chk no")},
        {"label": "Bank",         "value": _anchor_value(text, "bank", "financial")},
        {"label": "Memo",         "value": _anchor_value(text, "memo", "for", "re:")},
    ]

def _extract_invoice(text):
    amounts = _all_amounts(text)
    return [
        {"label": "Invoice Number",  "value": _anchor_value(text, "invoice no", "invoice number", "invoice #", "inv no", "inv #")},
        {"label": "Date",            "value": _anchor_value(text, "invoice date", "date") or _first_date(text)},
        {"label": "Due Date",        "value": _anchor_value(text, "due date", "payment due", "pay by")},
        {"label": "Vendor",          "value": _anchor_value(text, "from:", "vendor", "seller", "billed by")},
        {"label": "Amount",          "value": _anchor_value(text, "total", "amount due", "balance due") or (amounts[-1] if amounts else "")},
        {"label": "Payment Terms",   "value": _anchor_value(text, "payment terms", "terms", "net")},
    ]

def _extract_agreement(text):
    lines = text.splitlines()
    first_lines = " ".join(lines[:15])
    parties = _anchor_value(text, "between", "by and between") or _anchor_value(text, "parties")
    return [
        {"label": "Date",            "value": _anchor_value(text, "dated", "date:") or _first_date(text)},
        {"label": "Effective Date",  "value": _anchor_value(text, "effective date", "effective as of")},
        {"label": "Parties/Signers", "value": parties},
        {"label": "Amount/Value",    "value": _anchor_value(text, "consideration", "amount", "compensation", "total")},
        {"label": "Purpose Summary", "value": first_lines[:180].strip()},
        {"label": "Term",            "value": _anchor_value(text, "term", "duration", "period")},
    ]

def _extract_bank_statement(text):
    amounts = _all_amounts(text)
    return [
        {"label": "Period",           "value": _anchor_value(text, "statement period", "for the period", "period") or _first_date(text)},
        {"label": "Account Number",   "value": _anchor_value(text, "account number", "account no", "acct no", "acct #")},
        {"label": "Opening Balance",  "value": _anchor_value(text, "beginning balance", "opening balance", "previous balance")},
        {"label": "Closing Balance",  "value": _anchor_value(text, "ending balance", "closing balance", "current balance")},
        {"label": "Total Deposits",   "value": _anchor_value(text, "total deposits", "deposits")},
        {"label": "Total Withdrawals","value": _anchor_value(text, "total withdrawals", "withdrawals", "total debits")},
    ]

def _extract_receipt(text):
    amounts = _all_amounts(text)
    return [
        {"label": "Date",           "value": _first_date(text)},
        {"label": "Merchant",       "value": _anchor_value(text, "merchant", "store", "from") or (text.splitlines()[0] if text.splitlines() else "")},
        {"label": "Amount",         "value": _anchor_value(text, "total", "amount", "grand total") or (amounts[-1] if amounts else "")},
        {"label": "Payment Method", "value": _anchor_value(text, "payment method", "paid by", "cash", "credit", "debit", "visa", "mastercard")},
    ]

def _extract_other(text):
    amounts = _all_amounts(text)
    return [
        {"label": "Date",        "value": _first_date(text)},
        {"label": "Amount",      "value": amounts[0] if amounts else ""},
        {"label": "Parties",     "value": _anchor_value(text, "from", "to", "between")},
        {"label": "Description", "value": text[:200].strip()},
    ]

_EXTRACTORS = {
    "check": _extract_check,
    "invoice": _extract_invoice,
    "agreement": _extract_agreement,
    "bank_statement": _extract_bank_statement,
    "receipt": _extract_receipt,
    "other": _extract_other,
}

# ── CUSTOM MAPPING RESOLUTION ────────────────────────────────────

def _resolve_custom_mapping(text, source_label):
    """Find source_label in text and return the value on that line after the label."""
    for line in text.splitlines():
        if source_label.lower() in line.lower():
            val = re.sub(re.escape(source_label), "", line, flags=re.IGNORECASE).strip(" :-_")
            if val:
                return val
    # fallback: find source_label and grab next non-empty line
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if source_label.lower() in line.lower():
            for next_line in lines[i + 1:]:
                if next_line.strip():
                    return next_line.strip()
    return ""

# ── PUBLIC API ───────────────────────────────────────────────────

def process_document(file_bytes, filename, custom_mappings=None):
    """
    Extract fields from a document file.

    Returns:
        {
            "doc_type": str,
            "fields": [{"label": str, "source_label": str|None, "value": str, "is_custom": 0|1}]
        }

    Upgrade path: replace the body of this function with a Claude API call
    that returns the same shape. No other file needs to change.
    """
    if custom_mappings is None:
        custom_mappings = []

    ext = filename.rsplit(".", 1)[-1] if "." in filename else "pdf"
    text = extract_text(file_bytes, ext)
    doc_type = detect_doc_type(text)

    extractor = _EXTRACTORS.get(doc_type, _extract_other)
    default_fields = extractor(text)

    fields = [
        {"label": f["label"], "source_label": None, "value": f["value"], "is_custom": 0}
        for f in default_fields
    ]

    for mapping in custom_mappings:
        field_label = mapping.get("field_label", "").strip()
        source_label = mapping.get("source_label", "").strip()
        if not field_label or not source_label:
            continue
        value = _resolve_custom_mapping(text, source_label)
        fields.append({
            "label": field_label,
            "source_label": source_label,
            "value": value,
            "is_custom": 1,
        })

    return {"doc_type": doc_type, "fields": fields}
