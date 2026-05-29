from __future__ import annotations

import csv
import json
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib import error, request

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
INVENTORY_CSV = BASE_DIR / "inventory.csv"
SUPPLIERS_CSV = BASE_DIR / "suppliers.csv"
SALES_CSV = BASE_DIR / "sales_transactions.csv"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR / ".env")

HF_API_URL = "https://router.huggingface.co/v1/chat/completions"
HF_MODEL = os.getenv("HF_MODEL", "openai/gpt-oss-120b:fireworks-ai")
HF_TOKEN = os.getenv("HF_TOKEN")
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "60"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1200"))
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "low")
LOW_STOCK_THRESHOLD = int(os.getenv("LOW_STOCK_THRESHOLD", "10"))

app = FastAPI(title="SmartStock Chatbot", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=800)


class ChatResponse(BaseModel):
    reply: str
    intent: str
    suggestions: list[str]
    supplier_contact: dict | None = None


def _parse_int(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_float(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise RuntimeError(f"No se encontro {path.name}")

    with path.open(newline="", encoding="utf-8-sig") as file:
        return list(csv.DictReader(file))


def _load_suppliers() -> dict[str, dict]:
    if not SUPPLIERS_CSV.exists():
        return {}

    suppliers = {}
    for row in _load_csv(SUPPLIERS_CSV):
        supplier_id = row.get("SupplierID", "").strip()
        suppliers[supplier_id] = {
            "supplier_id": supplier_id,
            "name": row.get("SupplierName", "").strip(),
            "email": row.get("Email", "").strip(),
            "phone": row.get("Phone", "").strip(),
            "address": row.get("Address", "").strip(),
            "website": row.get("Website", "").strip(),
            "lead_time": _parse_int(row.get("LeadTime", "")),
        }

    return suppliers


def _load_sales() -> list[dict]:
    sales = []
    for row in _load_csv(SALES_CSV):
        quantity = _parse_int(row.get("Quantity", ""))
        unit_price = _parse_float(row.get("UnitPrice", ""))
        sales.append(
            {
                "transaction_id": row.get("TransactionID", "").strip(),
                "date": row.get("Date", "").strip(),
                "product_id": row.get("ProductID", "").strip(),
                "quantity": quantity,
                "unit_price": unit_price,
                "store_id": row.get("StoreID", "").strip(),
                "channel": row.get("Channel", "").strip(),
                "revenue": round(quantity * unit_price, 2)
                if quantity is not None and unit_price is not None
                else None,
            }
        )
    return sales


def _load_inventory() -> list[dict]:
    suppliers = _load_suppliers()
    inventory = []
    for row in _load_csv(INVENTORY_CSV):
        stock = _parse_int(row.get("Stock", ""))
        supplier_id = row.get("SupplierID", "").strip()
        supplier_info = suppliers.get(supplier_id, {})

        inventory.append(
            {
                "product_id": row.get("ProductID", "").strip(),
                "name": row.get("ProductName", "").strip(),
                "category": row.get("Category", "").strip(),
                "stock": stock,
                "price": _parse_float(row.get("Price", "")),
                "supplier_id": supplier_id,
                "supplier_name": supplier_info.get("name", "Unknown"),
                "supplier_email": supplier_info.get("email", ""),
                "supplier_phone": supplier_info.get("phone", ""),
                "supplier_lead_time": supplier_info.get("lead_time"),
                "warehouse": row.get("Warehouse", "").strip(),
                "last_restocked": row.get("LastRestocked", "").strip(),
                "expiry_date": row.get("ExpiryDate", "").strip(),
                "weight": _parse_float(row.get("Weight", "")),
            }
        )

    return inventory


def _sales_summary(days: int = 30) -> list[dict]:
    sales = _load_sales()
    inventory_by_id = {item["product_id"]: item for item in _load_inventory()}
    sale_dates = [_parse_date(sale["date"]) for sale in sales]
    valid_dates = [sale_date for sale_date in sale_dates if sale_date is not None]
    if not valid_dates:
        return []

    max_date = max(valid_dates)
    start_date = max_date - timedelta(days=days - 1)
    totals = defaultdict(lambda: {"units_sold": 0, "revenue": 0.0, "transactions": 0})

    for sale in sales:
        sale_date = _parse_date(sale["date"])
        if sale_date is None or sale_date < start_date:
            continue

        product_id = sale["product_id"]
        quantity = sale["quantity"] or 0
        revenue = sale["revenue"] or 0.0
        totals[product_id]["units_sold"] += quantity
        totals[product_id]["revenue"] += revenue
        totals[product_id]["transactions"] += 1

    summary = []
    for product_id, metrics in totals.items():
        product = inventory_by_id.get(product_id, {})
        stock = product.get("stock")
        lead_time_days = product.get("supplier_lead_time") or 0
        avg_daily_demand = metrics["units_sold"] / days
        lead_time_demand = avg_daily_demand * lead_time_days
        stockout_risk = stock is not None and stock <= max(LOW_STOCK_THRESHOLD, lead_time_demand)

        summary.append(
            {
                "product_id": product_id,
                "name": product.get("name", ""),
                "category": product.get("category", ""),
                "stock": stock,
                "units_sold_last_30_days": metrics["units_sold"],
                "avg_daily_demand": round(avg_daily_demand, 2),
                "revenue_last_30_days": round(metrics["revenue"], 2),
                "transactions_last_30_days": metrics["transactions"],
                "supplier_id": product.get("supplier_id", ""),
                "supplier_name": product.get("supplier_name", ""),
                "supplier_email": product.get("supplier_email", ""),
                "supplier_phone": product.get("supplier_phone", ""),
                "lead_time_days": product.get("supplier_lead_time"),
                "projected_lead_time_demand": round(lead_time_demand, 2),
                "stockout_risk": stockout_risk,
            }
        )

    return sorted(summary, key=lambda item: (not item["stockout_risk"], -item["units_sold_last_30_days"]))


def _inventory_with_demand() -> list[dict]:
    demand_by_product = {item["product_id"]: item for item in _sales_summary()}
    return [
        {**item, "demand": demand_by_product.get(item["product_id"])}
        for item in _load_inventory()
    ]


def _critical_items() -> list[dict]:
    return [
        item
        for item in _inventory_with_demand()
        if item["stock"] is not None and item["stock"] <= LOW_STOCK_THRESHOLD
    ]


def _is_reorder_query(message: str) -> bool:
    text = message.lower()
    return any(
        word in text
        for word in [
            "reorden",
            "reponer",
            "comprar",
            "pedido",
            "ordenar",
            "lead time",
            "reorder",
            "restock",
            "purchase",
            "order",
            "buy",
            "supplier",
            "stockout",
            "inventory"
        ]
    )


def _inventory_context(message: str = "") -> str:
    inventory = _inventory_with_demand()
    demand_summary = _sales_summary()
    risk_ids = {item["product_id"] for item in demand_summary if item["stockout_risk"]}
    low_stock_ids = {
        item["product_id"]
        for item in inventory
        if item["stock"] is not None and item["stock"] <= LOW_STOCK_THRESHOLD
    }
    reorder_candidate_ids = risk_ids | low_stock_ids
    compact_inventory = []

    for item in inventory:
        demand = item.get("demand") or {}
        compact_inventory.append(
            {
                "product_id": item["product_id"],
                "name": item["name"],
                "category": item["category"],
                "stock": item["stock"],
                "price": item["price"],
                "warehouse": item["warehouse"],
                "supplier_id": item["supplier_id"],
                "supplier_name": item["supplier_name"],
                "supplier_email": item["supplier_email"],
                "supplier_phone": item["supplier_phone"],
                "lead_time_days": item["supplier_lead_time"],
                "units_sold_last_30_days": demand.get("units_sold_last_30_days", 0),
                "avg_daily_demand": demand.get("avg_daily_demand", 0),
                "projected_lead_time_demand": demand.get("projected_lead_time_demand", 0),
                "stockout_risk": demand.get("stockout_risk", item["product_id"] in low_stock_ids),
            }
        )

    reorder_candidates = [
        item
        for item in compact_inventory
        if item["product_id"] in reorder_candidate_ids
    ]

    context = {"low_stock_threshold": LOW_STOCK_THRESHOLD}
    if _is_reorder_query(message):
        context["reorder_candidates"] = reorder_candidates
        context["note"] = (
    "These are products with low stock or stockout risk "
    "based on real demand and supplier lead times."
)
    else:
        context["inventory"] = compact_inventory
        context["reorder_candidates"] = reorder_candidates

    return json.dumps(context, ensure_ascii=True, separators=(",", ":"))


def _system_prompt(message: str = "") -> str:
    return (
        "You are SmartStock, an inventory assistant for small businesses. "
        "IMPORTANT: Always respond in English, regardless of the language used by the user. "
        "Be concise, clear, and actionable. "
        "Use only the inventory data provided; if information is missing, say so. "
        f"Consider stock low when Stock is less than or equal to {LOW_STOCK_THRESHOLD}. "
        "When suggesting reorders, consider stock levels, real sales demand, lead time, supplier information, warehouse location, prices, and dates. "
        "If recommending supplier contact, include email and phone when available. "
        "Do not use Markdown tables. "
        "Format reorder recommendations as: short title, one-line summary, numbered list of products with compact bullet points, and immediate actions. "
        "Provide the final answer directly without exposing internal reasoning. "
        "Do not invent SKUs, prices, suppliers, or quantities that are not available.\n\n"
        f"Inventory data:\n{_inventory_context(message)}"
    )


def _short_error(exc: Exception) -> str:
    return f"{exc.__class__.__name__}: {exc}"


def _call_hugging_face(message: str) -> tuple[str | None, str | None]:
    if not HF_TOKEN:
        return None, "HF_TOKEN no configurado"

    payload = {
        "model": HF_MODEL,
        "messages": [
            {"role": "system", "content": _system_prompt(message)},
            {"role": "user", "content": message},
        ],
        "temperature": 0.2,
        "max_tokens": LLM_MAX_TOKENS,
        "reasoning_effort": LLM_REASONING_EFFORT,
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": "application/json",
    }

    api_request = request.Request(HF_API_URL, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(api_request, timeout=LLM_TIMEOUT_SECONDS) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:500]
        return None, f"HTTP {exc.code}: {details}"
    except (error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return None, _short_error(exc)

    try:
        choice = data["choices"][0]
        message = choice.get("message") or {}
        content = message.get("content") or choice.get("text") or ""
        if isinstance(content, list):
            content = "\n".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        reply = str(content).strip()
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        snippet = json.dumps(data, ensure_ascii=True)[:700]
        return None, f"Respuesta inesperada de Hugging Face: {_short_error(exc)}. Raw: {snippet}"

    if not reply:
        finish_reason = data.get("choices", [{}])[0].get("finish_reason")
        snippet = json.dumps(data, ensure_ascii=True)[:700]
        return None, f"Hugging Face no devolvio contenido. finish_reason={finish_reason}. Raw: {snippet}"

    return reply, None


def _local_reply(message: str) -> str:
    """Fallback simple sin LLM: responde consultas comunes usando CSV local."""
    text = message.lower()
    inventory = _load_inventory()
    suppliers = _load_suppliers()

    def format_item(it):
        return f"- {it['product_id']} {it['name']}: stock={it['stock']} (Proveedor: {it.get('supplier_name','Desconocido')})"

    if any(k in text for k in ["critico", "bajo", "agotado", "cuales estan bajos", "stock bajo"]):
        crit = [it for it in inventory if it.get("stock") is not None and it["stock"] <= LOW_STOCK_THRESHOLD]
        if not crit:
            return "No hay productos por debajo del umbral de stock configurado."
        lines = ["Productos con stock bajo:"] + [format_item(i) for i in crit]
        return "\n".join(lines)

    if any(k in text for k in ["reponer", "reorden", "ordenar", "comprar", "pedido"]):
        crit = [it for it in inventory if it.get("stock") is not None and it["stock"] <= LOW_STOCK_THRESHOLD]
        if not crit:
            return "No hay necesidades de reorden inmediatas según el umbral actual."
        lines = ["Sugerencias de reorden (estimadas):"]
        for it in crit:
            qty = (LOW_STOCK_THRESHOLD * 2) - (it["stock"] or 0)
            sup = suppliers.get(it.get("supplier_id"), {})
            lead = f" (lead time: {sup.get('lead_time')} días)" if sup.get("lead_time") else ""
            lines.append(f"- {it['product_id']} {it['name']}: pedir {qty} unidades a {sup.get('name','Proveedor desconocido')}{lead}")
        return "\n".join(lines)

    for sup_id, sup in suppliers.items():
        if sup_id.lower() in text or sup.get("name", "").lower() in text:
            return (
                f"Proveedor {sup.get('name')}: email={sup.get('email')}, telefono={sup.get('phone')},"
                f" direccion={sup.get('address')}, lead_time={sup.get('lead_time') or 'N/A'} días"
            )

    return (
        "Lo siento, no puedo procesar esa consulta sin el servicio de IA. "
        "Prueba: 'Cuales estan bajos de stock?' o 'Genera una orden de compra'."
    )


def _suggestions_for(message: str) -> list[str]:
    text = message.lower().strip()

    if any(
        word in text
        for word in [
            "reorder",
            "restock",
            "purchase",
            "order",
            "buy",
            "reponer",
            "reorden",
            "pedido"
        ]
    ):
        return [
            "Generate a purchase order",
            "Which product is most critical?",
            "Simulate higher demand"
        ]

    if any(
        word in text
        for word in [
            "critical",
            "low stock",
            "out of stock",
            "risk",
            "stock",
            "critico",
            "bajo",
            "agotado"
        ]
    ):
        return [
            "What should I restock?",
            "Show all critical items"
        ]

    if any(word in text for word in ["simulate", "simulation", "demand"]):
        return [
            "What should I restock?",
            "Which products are low in stock?",
            "Generate a purchase order"
        ]

    return [
        "What products should I reorder?",
        "Which items are low in stock?",
        "Simulate higher demand"
    ]

def _build_reply(message: str) -> ChatResponse:
    llm_reply, llm_error = _call_hugging_face(message)
    if llm_reply:
        supplier_contact = None
        inventory = _load_inventory()
        suppliers_data = _load_suppliers()

        for item in inventory:
            if item["supplier_name"].lower() in message.lower() or item["supplier_id"].lower() in message.lower():
                supplier_id = item["supplier_id"]
                if supplier_id in suppliers_data:
                    supplier_contact = suppliers_data[supplier_id]
                    break

        return ChatResponse(
            intent="llm",
            reply=llm_reply,
            suggestions=_suggestions_for(message),
            supplier_contact=supplier_contact,
        )

    if False:  # Local fallback disabled; chat is IA-only.
        local = _local_reply(message)
        supplier_contact = None
        inventory = _load_inventory()
        suppliers_data = _load_suppliers()
        for item in inventory:
            if item["supplier_name"].lower() in message.lower() or item["supplier_id"].lower() in message.lower():
                supplier_id = item["supplier_id"]
                if supplier_id in suppliers_data:
                    supplier_contact = suppliers_data[supplier_id]
                    break

        return ChatResponse(
            intent="local",
            reply=local,
            suggestions=_suggestions_for(message),
            supplier_contact=supplier_contact,
        )

    raise HTTPException(
        status_code=503,
        detail=f"No se pudo conectar con el servicio de IA. {llm_error}",
    )


# ── Endpoints ──────────────────────────────────────────────────────────

@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "llm_enabled": bool(HF_TOKEN),
        "llm_model": HF_MODEL if HF_TOKEN else None,
    }


@app.get("/llm/status")
def llm_status() -> dict:
    reply, llm_error = _call_hugging_face("Responde solamente: OK")
    return {
        "configured": bool(HF_TOKEN),
        "provider": "huggingface",
        "model": HF_MODEL if HF_TOKEN else None,
        "ready": bool(reply),
        "error": llm_error,
    }


@app.get("/inventory")
def inventory() -> list[dict]:
    return _inventory_with_demand()


@app.get("/inventory/critical")
def critical_inventory() -> list[dict]:
    return _critical_items()


@app.get("/sales")
def sales() -> list[dict]:
    return _load_sales()


@app.get("/demand")
def demand(
    days: int = Query(
        default=30,
        ge=1,
        le=365,
        description="Ventana de análisis en días (1-365). Por defecto: 30.",
    )
) -> dict:
    """
    Devuelve resumen de demanda en la ventana de los últimos `days` días
    (usando la fecha máxima del CSV como referencia de hoy).

    Retorna:
      window_days       — ventana usada
      ref_date          — fecha de referencia del dataset (YYYY-MM-DD)
      total_units_sold  — unidades totales vendidas en la ventana
      total_revenue     — ingresos totales en la ventana
      by_sku            — lista ordenada por unidades vendidas (desc)
    """
    summary = _sales_summary(days=days)

    # Fecha de referencia: máximo disponible en el CSV de ventas
    sales_data = _load_sales()
    valid_dates = [_parse_date(s["date"]) for s in sales_data]
    valid_dates = [d for d in valid_dates if d is not None]
    ref_date = max(valid_dates).isoformat() if valid_dates else None

    return {
        "window_days":      days,
        "ref_date":         ref_date,
        "total_units_sold": sum(i["units_sold_last_30_days"] for i in summary),
        "total_revenue":    round(sum(i["revenue_last_30_days"] for i in summary), 2),
        "by_sku": [
            {
                "sku":              i["product_id"],
                "name":             i["name"],
                "units_sold":       i["units_sold_last_30_days"],
                "revenue":          i["revenue_last_30_days"],
                "avg_daily_demand": i["avg_daily_demand"],
            }
            for i in sorted(summary, key=lambda x: -x["units_sold_last_30_days"])
        ],
    }


@app.get("/suppliers")
def suppliers() -> dict[str, dict]:
    return _load_suppliers()


@app.get("/suppliers/{supplier_id}")
def supplier_contact(supplier_id: str) -> dict:
    suppliers_data = _load_suppliers()
    supplier = suppliers_data.get(supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail=f"Proveedor {supplier_id} no encontrado")
    return supplier


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    return _build_reply(request.message)