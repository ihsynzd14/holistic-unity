"""
Meta Conversions API (CAPI) integration for Holistic Unity.

Sends server-side events to Meta Pixel for accurate attribution
immune to ad blockers and iOS tracking restrictions.

Events tracked:
  - CompleteRegistration: cliente crea account
  - Lead: pratico completa onboarding/registrazione
  - Purchase: sessione prenotata e pagata (Stripe webhook)

Pixel ID: 1445760663897743 (Holistic Unity_Dataset)

Usage:
  from app.services.meta_capi import send_capi_event, build_event_id, extract_client_ip

  await send_capi_event(
      event_name="CompleteRegistration",
      event_id=build_event_id("registration", user.id),
      email=user.email,
      client_ip=extract_client_ip(request),
      client_user_agent=request.headers.get("user-agent"),
      action_source="website",  # o "app" se dall'app iOS
      event_source_url=str(request.url),
  )

Setup .env:
  META_PIXEL_ID=1445760663897743
  META_ACCESS_TOKEN=<system user token>
  META_API_VERSION=v22.0
  # META_TEST_EVENT_CODE=TEST12345  # opzionale, solo durante testing

Deduplicazione pixel-web ↔ CAPI:
  Usa SEMPRE lo stesso event_id sia nel pixel JS che nel CAPI.
  Meta deduplica automaticamente per (event_name, event_id) entro 7 giorni.
"""
import hashlib
import logging
import os
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────
META_PIXEL_ID = os.getenv("META_PIXEL_ID", "1445760663897743")
META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN")
META_API_VERSION = os.getenv("META_API_VERSION", "v22.0")
# Opzionale: setta solo durante testing per vedere eventi in Events Manager → Test Events
META_TEST_EVENT_CODE: Optional[str] = os.getenv("META_TEST_EVENT_CODE") or None

META_CAPI_URL = f"https://graph.facebook.com/{META_API_VERSION}/{META_PIXEL_ID}/events"
HTTP_TIMEOUT_SEC = 5.0

# ── Shared async HTTP client (connection pool) ──────────────────────────────
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    """Lazily create a shared httpx client. Reuses connection pool."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC)
    return _client


async def close_capi_client() -> None:
    """Call this on FastAPI shutdown (app.on_event('shutdown'))."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ── Helpers ──────────────────────────────────────────────────────────────────
def _hash(value: str) -> str:
    """SHA-256 hash normalizzato (lowercase + trim), come richiesto da Meta CAPI."""
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()


def build_event_id(event_type: str, entity_id) -> str:
    """
    Costruisce un event_id deterministico per la deduplicazione pixel↔CAPI.

    Examples:
        build_event_id("registration", user.id)  → "registration_42"
        build_event_id("lead", practitioner.id) → "lead_17"
        build_event_id("purchase", session_id)  → "purchase_cs_test_a1B2c3D4"
    """
    return f"{event_type}_{entity_id}"


def extract_client_ip(request) -> Optional[str]:
    """
    Estrae l'IP del client da una Request FastAPI, gestendo reverse proxy.

    Order of preference:
      1. X-Forwarded-For (Nginx, Cloudflare): primo IP della catena
      2. X-Real-IP (Nginx alt)
      3. request.client.host (direct)
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    xri = request.headers.get("x-real-ip")
    if xri:
        return xri.strip()
    if request.client and request.client.host:
        return request.client.host
    return None


# ── Main API ─────────────────────────────────────────────────────────────────
async def send_capi_event(
    event_name: str,
    event_id: str,
    *,
    email: Optional[str] = None,
    phone: Optional[str] = None,  # formato E.164 senza '+', es. "393331234567"
    external_id: Optional[str] = None,  # user_id interno (verrà hashato)
    client_ip: Optional[str] = None,
    client_user_agent: Optional[str] = None,
    fbp: Optional[str] = None,  # cookie _fbp del browser (se disponibile)
    fbc: Optional[str] = None,  # cookie _fbc del browser (se disponibile)
    value: Optional[float] = None,
    currency: str = "EUR",
    custom_data: Optional[dict] = None,
    action_source: str = "website",
    event_source_url: Optional[str] = None,
) -> Optional[dict]:
    """
    Invia un evento server-side al Meta Conversions API.

    Args:
        event_name: Lead | CompleteRegistration | Purchase | AddToCart | InitiateCheckout | etc.
        event_id: ID univoco per deduplicazione pixel-web ↔ CAPI
        email: email utente (hashata SHA-256)
        phone: numero di telefono in formato E.164 senza '+' (hashato)
        external_id: ID utente interno (hashato — alza match rate ~10-15%)
        client_ip: IP del client (raccomandato per match rate)
        client_user_agent: User-Agent del client (raccomandato per match rate)
        fbp: cookie '_fbp' del browser, se passato dal frontend
        fbc: cookie '_fbc' del browser, se passato dal frontend
        value: importo (solo per Purchase, in account currency)
        currency: ISO 4217, default EUR
        custom_data: dict aggiuntivi (content_name, content_ids, num_items, predicted_ltv, ...)
        action_source: 'website' | 'app' | 'physical_store' | 'system_generated' | 'email' | 'chat'
        event_source_url: URL della pagina sorgente (per action_source='website')

    Returns:
        dict response Meta se OK, None se errore. Non blocca MAI il flusso del chiamante
        (logga e ritorna None in caso di errore).
    """
    if not META_ACCESS_TOKEN:
        logger.warning("[META CAPI] META_ACCESS_TOKEN non configurato, skip %s", event_name)
        return None

    user_data: dict = {}
    if email:
        user_data["em"] = [_hash(email)]
    if phone:
        digits = "".join(c for c in phone if c.isdigit())
        if digits:
            user_data["ph"] = [_hash(digits)]
    if external_id is not None:
        user_data["external_id"] = [_hash(str(external_id))]
    if client_ip:
        user_data["client_ip_address"] = client_ip
    if client_user_agent:
        user_data["client_user_agent"] = client_user_agent
    if fbp:
        user_data["fbp"] = fbp
    if fbc:
        user_data["fbc"] = fbc

    event_payload: dict = {
        "event_name": event_name,
        "event_time": int(time.time()),
        "event_id": event_id,
        "action_source": action_source,
        "user_data": user_data,
    }
    if event_source_url:
        event_payload["event_source_url"] = event_source_url

    cd: dict = {}
    if event_name == "Purchase" and value is not None:
        cd["value"] = round(float(value), 2)
        cd["currency"] = currency
    if custom_data:
        cd.update(custom_data)
    if cd:
        event_payload["custom_data"] = cd

    payload: dict = {
        "data": [event_payload],
        "access_token": META_ACCESS_TOKEN,
    }
    if META_TEST_EVENT_CODE:
        payload["test_event_code"] = META_TEST_EVENT_CODE

    try:
        response = await _get_client().post(META_CAPI_URL, json=payload)
        response.raise_for_status()
        data = response.json()
        received = data.get("events_received", 0)
        if received > 0:
            logger.info(
                "[META CAPI] %s OK (id=%s, received=%s, fbtrace=%s)",
                event_name, event_id, received, data.get("fbtrace_id"),
            )
        else:
            logger.warning(
                "[META CAPI] %s sent ma events_received=0 (id=%s, resp=%s)",
                event_name, event_id, data,
            )
        return data
    except httpx.HTTPStatusError as e:
        logger.error(
            "[META CAPI] HTTP %s on %s: %s",
            e.response.status_code, event_name, e.response.text[:500],
        )
    except httpx.TimeoutException:
        logger.warning("[META CAPI] timeout on %s (id=%s)", event_name, event_id)
    except Exception as e:  # pragma: no cover
        logger.exception("[META CAPI] unhandled error on %s: %s", event_name, e)

    return None  # fail silently, do not block caller
