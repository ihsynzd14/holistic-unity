#!/usr/bin/env python3
"""
Validatore locale del modulo Meta CAPI.

Esegui DA LOCAL (non dal VPS) per testare che il token + pixel + payload
funzionino, prima del deploy in produzione.

Usage:
  cd backend/
  python3 -m venv .venv && source .venv/bin/activate
  pip install httpx
  cp .env.addon .env
  export $(cat .env | grep -v '^#' | xargs)
  python3 test_capi_local.py
"""
import asyncio
import os
import sys
import time

# permetti import del modulo come fosse nel backend prod
sys.path.insert(0, os.path.dirname(__file__))

from app.services.meta_capi import send_capi_event, build_event_id


async def main():
    if not os.getenv("META_ACCESS_TOKEN"):
        print("❌ Setta META_ACCESS_TOKEN nell'env prima di lanciare il test.")
        print("   export $(cat .env | grep -v '^#' | xargs)")
        sys.exit(1)

    # Per vedere l'evento in tempo reale in Events Manager → Test Events,
    # decommenta e usa un codice di Events Manager → Test Events tab.
    # os.environ["META_TEST_EVENT_CODE"] = "TEST12345"

    print(f"Pixel: {os.getenv('META_PIXEL_ID')}")
    print(f"API: {os.getenv('META_API_VERSION', 'v22.0')}")
    print()

    # Test 1: CompleteRegistration
    print("→ Test CompleteRegistration...")
    res = await send_capi_event(
        event_name="CompleteRegistration",
        event_id=build_event_id("test_registration", int(time.time())),
        email="test+capi@holisticunity.app",
        external_id="test_user_42",
        client_ip="93.39.158.10",
        client_user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        action_source="website",
        event_source_url="https://holisticunity.app/early_access",
        custom_data={"content_name": "test_capi_local"},
    )
    print(f"  result: {res}")
    print()

    # Test 2: Lead
    print("→ Test Lead...")
    res = await send_capi_event(
        event_name="Lead",
        event_id=build_event_id("test_lead", int(time.time())),
        email="test+practitioner@holisticunity.app",
        action_source="website",
        custom_data={"content_name": "practitioner_onboarding"},
    )
    print(f"  result: {res}")
    print()

    # Test 3: Purchase
    print("→ Test Purchase...")
    res = await send_capi_event(
        event_name="Purchase",
        event_id=build_event_id("test_purchase", "stripe_cs_test_xxx"),
        email="test+customer@holisticunity.app",
        value=50.0,
        currency="EUR",
        action_source="website",
        custom_data={
            "content_name": "holistic_session",
            "content_type": "product",
            "content_ids": ["session_naturopatia_60min"],
            "num_items": 1,
        },
    )
    print(f"  result: {res}")
    print()

    print("✓ Test completato. Controlla Events Manager → Test Events se hai")
    print("  settato META_TEST_EVENT_CODE, oppure Overview per la statistica generale.")

    from app.services.meta_capi import close_capi_client
    await close_capi_client()


if __name__ == "__main__":
    asyncio.run(main())
