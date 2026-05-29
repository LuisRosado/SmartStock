# SmartStock

https://github.com/user-attachments/assets/531102da-749e-4778-8d6a-21c022dbd7d1

SmartStock is a minimal application for managing and querying inventory through a chat interface powered by a language model, with demand analysis based on sales transactions and a visual dashboard.

Quick summary:

- **Backend**: FastAPI in `app/main.py`.
- **Frontend**: static files in `static/` (`index.html`, `app.js`, `dashboard.js`, `styles.css`).
- **Data**: CSVs in the repository root: `inventory.csv`, `suppliers.csv`, `sales_transactions.csv`.

**Purpose**: Conversational inventory queries, critical item detection, demand-driven replenishment suggestions, and a dashboard with KPIs and charts.

---

## Features (implemented)

- Conversational queries via `POST /chat` that combine inventory and demand context to produce actionable responses.
- Full inventory listing: `GET /inventory`.
- Critical / low-stock detection: `GET /inventory/critical` (uses `LOW_STOCK_THRESHOLD`).
- Demand calculation per product from `sales_transactions.csv`: `GET /demand?days=<n>` (defaults to 30 days).
- Replenishment suggestions based on demand and thresholds, with a reorder list displayed on the dashboard.
- Supplier management and lookup: `GET /suppliers` and `GET /suppliers/{supplier_id}`; chat responses may include `supplier_contact` when relevant.
- Frontend dashboard with charts (Chart.js), KPIs and a reorder table (`static/dashboard.js`).
- Optional integration with Hugging Face Chat Completions (`HF_TOKEN`, `HF_MODEL`) and a heuristic fallback `_local_reply()` when the LLM is unavailable.
- Diagnostic endpoints: `GET /health` and `GET /llm/status`.
- CSV-backed data for easy testing and prototyping, with straightforward migration to a database if needed.
- Local development with autoreload (`uvicorn --reload`) and Windows-specific guidance.

---

**Requirements**

- Python 3.9+ (tested on Windows with 3.10/3.11/3.13).
- Packages: listed in `requirements.txt` (FastAPI, pandas, requests, python-dotenv, etc.).
- Optional: Hugging Face account and token to use the chat endpoint.

---

**Installation (local)**

1. Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r requirements.txt
```

3. Environment variables: copy `.env.example` to `.env` and set the following keys if using Hugging Face:

```text
HF_TOKEN=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
HF_MODEL=openai/gpt-oss-120b:fireworks-ai
LLM_TIMEOUT_SECONDS=60
LLM_MAX_TOKENS=1200
LLM_REASONING_EFFORT=low
LOW_STOCK_THRESHOLD=10
```

You can also export them in PowerShell:

```powershell
$env:HF_TOKEN="hf_xxxxxxxxxxxxxxxxx"
$env:HF_MODEL="openai/gpt-oss-120b:fireworks-ai"
```

4. Run the application (development):

```powershell
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8010
```

Open your browser at `http://127.0.0.1:8010`.

---

**Repository structure**

- `app/` — backend code (FastAPI). See `app/main.py`.
- `static/` — static frontend (chat and dashboard).
- `inventory.csv` — current inventory.
- `suppliers.csv` — supplier contacts.
- `sales_transactions.csv` — sales history used for demand calculations.

---

**API — Main endpoints**

Note: routes are defined in `app/main.py`.

- `GET /health` : basic health check.
- `GET /llm/status` : LLM status (connects to Hugging Face if configured).
- `GET /inventory` : returns the full inventory (CSV loaded in memory).
- `GET /inventory/critical` : returns low-stock items according to `LOW_STOCK_THRESHOLD`.
- `GET /sales` : returns sales transactions (loaded from `sales_transactions.csv`).
- `GET /demand?days=<n>` : demand summary per product for the last `n` days (default 30).
- `GET /suppliers` : list of suppliers and contacts.
- `GET /suppliers/{supplier_id}` : single supplier details.
- `POST /chat` : main chatbot endpoint. Send a JSON payload matching the `ChatRequest` schema (see `app/main.py`) and receive a `ChatResponse`.

Quick example (PowerShell):

```powershell
Invoke-RestMethod -Method GET http://127.0.0.1:8010/demand

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8010/chat -Body (@{prompt="Which product needs replenishment?"} | ConvertTo-Json) -ContentType 'application/json'
```

---

**Data formats (CSV)**

- `inventory.csv` — expected columns: `product_id,product_name,sku,quantity,location` (if your file differs, adjust loading in `app/main.py`).
- `suppliers.csv` — minimum columns: `supplier_id,name,phone,email,products` (products supplied, optionally as `;`-separated list).
- `sales_transactions.csv` — minimum columns: `tx_id,product_id,quantity,date` where `date` is ISO (`YYYY-MM-DD`). Demand calculations use these rows.

---

**Frontend**

The frontend is static and served by FastAPI at `/static/`.

- Open [static/index.html](static/index.html) in your browser through the server.
- `static/app.js` handles the chat UI and response rendering.
- `static/dashboard.js` draws charts (Chart.js) and consumes `/demand` and `/inventory`.

If you develop the dashboard separately, you can copy `claude/` or `temp/v1/` into `static/`, but review differences before overwriting existing files.

---

**LLM integration**

The app supports calls to Hugging Face Chat Completions via `HF_API_URL` / `router.huggingface.co` using `HF_TOKEN`. There is a fallback function `_local_reply()` in `app/main.py` that implements heuristic responses when the LLM is unavailable — review and adjust that logic if you want richer offline behavior.

Important variables:

- `HF_TOKEN` — Hugging Face token.
- `HF_MODEL` — model name to use.
- `LLM_TIMEOUT_SECONDS`, `LLM_MAX_TOKENS`, `LLM_REASONING_EFFORT` — parameters for LLM calls.

---

**Development & testing**

- Run the server with `--reload` for development.
- Edit CSVs and refresh requests to see changes reflected in the UI.
- Use `curl`/`Invoke-RestMethod` or Postman to debug endpoints.

---

**Common issues & troubleshooting**

- Port in use: if `8010` is busy, kill the process or use a different port.
- `ModuleNotFoundError: No module named 'uvicorn'`: install dependencies inside the virtual environment.
- 403/502 from Hugging Face: check `HF_MODEL` and model availability; try suffixes like `:fireworks-ai` or `:cheapest` if the router picks a restricted route.
- Frontend not loading CSS/JS: verify `static/index.html` uses `/static/...` paths and that FastAPI is serving the `static/` folder.

---

**Best practices**

- Keep `suppliers.csv` and `sales_transactions.csv` up to date so demand logic remains accurate.
- Review any automated patches (for example from Claude or other assistants) before overwriting `app/main.py` to avoid losing fallback logic.

---

**Contributions**

If you want to improve the project:

- Add authentication and permissions to the API.
- Real persistence (SQLite/Postgres) instead of CSVs.
- ETL pipeline for ingesting sales and syncing with suppliers.

---

**License & credits**

This repository is a prototype. Add a license (`MIT`, `Apache-2.0`, etc.) if you plan to publish it.

If you want, I can:

- Add detailed `POST /chat` payload examples.
- Generate a production-ready `static/dashboard.html` and deploy it to `static/`.
- Integrate a minimal persistence layer (SQLite) and migrations.

Tell me which you prefer and I'll adapt it.
