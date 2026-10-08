# Audit Stack

Local web-based audit platform (Flask + SQLite + vanilla JS).

**Modules:** Risk Assessment (trial balance variance & materiality), Support Reader (offline document extraction), 3-Way Match Automator.

## Run locally
```
pip install -r requirements.txt
python3 app.py   # http://localhost:5000
```
Sample data is in `mock_data/`. The SQLite database is created on first run.
