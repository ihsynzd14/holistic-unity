# Holistic Unity — Modello Pagamenti Completo

**Ultimo aggiornamento:** 16 Aprile 2026
**Versione:** 2.0 (post-audit)

---

## 1. Panoramica del flusso di pagamento

```
Cliente (iOS App)
    │
    ▼ Seleziona servizio + data/ora
    │
    ▼ Vede: Prezzo sessione + Processing fee = Totale
    │
    ▼ Paga con carta (Stripe PaymentSheet)
    │
    ▼ Stripe processa il pagamento (Destination Charge)
    │
    ├──► Terapista riceve 80% del prezzo sessione (trasferimento automatico)
    │
    ├──► Piattaforma trattiene 20% commissione + processing fee
    │    (Stripe deduce la sua fee effettiva dalla application_fee)
    │
    └──► Webhook conferma il pagamento → booking status = "confirmed"
```

---

## 2. Cosa paga il cliente

### Sessione singola
| Voce | Formula | Esempio (€80) |
|------|---------|---------------|
| Prezzo sessione | `service.price` | €80.00 |
| Processing fee | `prezzo × 2.5% + €0.25` | €2.25 |
| **Totale addebitato** | `prezzo + processing fee` | **€82.25** |

### Pack di sessioni
| Voce | Formula | Esempio (pack 4×€68) |
|------|---------|---------------------|
| Prezzo pack | `pack_price × pack_size` | €272.00 |
| Processing fee | `totale_pack × 2.5% + €0.25` | €7.05 |
| **Totale addebitato** | `pack + processing fee` | **€279.05** |

### Sessione con credito (da pack precedente)
| Voce | Importo |
|------|---------|
| Prezzo | €0.00 (già pagato nel pack) |
| Processing fee | €0.00 |
| **Totale** | **€0.00** |

---

## 3. Come si dividono i soldi

### Esempio: sessione singola a €80

```
Cliente paga: €82.25 (€80 + €2.25 processing)
    │
    ├──► Stripe deduce la sua fee reale (~€1.45 per carta EEA)
    │
    ├──► application_fee_amount = €18.25 (commissione €16 + processing €2.25)
    │    Piattaforma riceve netto: €18.25 - €1.45 (Stripe) = €16.80
    │
    └──► Terapista riceve: €82.25 - €18.25 = €64.00
         (equivalente all'80% del prezzo sessione)
```

### Ripartizione dettagliata

| Destinatario | Importo | Come |
|-------------|---------|------|
| **Terapista** | €64.00 (80% di €80) | Trasferimento automatico Stripe al connected account |
| **Piattaforma (lordo)** | €18.25 | `application_fee_amount` trattenuto da Stripe |
| **Stripe (fee reale)** | ~€1.45 | Dedotto dalla `application_fee` della piattaforma |
| **Piattaforma (netto)** | ~€16.80 | `application_fee` - fee Stripe |

---

## 4. Costanti nel codice

| Costante | Valore | Dove | Note |
|----------|--------|------|------|
| `PLATFORM_FEE_PERCENT` | `0.20` (20%) | Edge functions + `AppConstants.swift` | Commissione piattaforma |
| `STRIPE_PERCENT` | `0.025` (2.5%) | Edge functions | Tariffa UK usata per tutte le carte |
| `STRIPE_FIXED_CENTS` | `25` (€0.25) | Edge functions | Componente fissa |
| `IVA_RATE` | `0.22` (22%) | Edge functions | **Non addebitata al cliente** |
| `ITALY_VARIANTS` | `["IT", "ITALY", "ITALIA"]` | Edge functions | Per determinare se il terapista e' italiano |

### Costanti legacy (ancora nel codice ma NON usate nel calcolo attuale)
| Costante | Valore | Stato |
|----------|--------|-------|
| `SERVICE_FEE_PERCENT` | `0.029` (2.9%) | **DA RIMUOVERE** — sostituita da `STRIPE_PERCENT` |
| `SERVICE_FEE_FIXED` | `30` (€0.30) | **DA RIMUOVERE** — sostituita da `STRIPE_FIXED_CENTS` |

---

## 5. IVA / VAT — Regole attuali

### Italia — Regime forfettario (maggioranza dei terapisti)
- Il terapista **NON addebita IVA** ai propri clienti
- La piattaforma **NON addebita IVA** al cliente al momento del pagamento
- La piattaforma emette fattura per la commissione del 20% al terapista
- L'IVA al 22% sulla commissione viene **fatturata separatamente** al terapista
- Esempio: commissione €16 → fattura al terapista: €16 + IVA €3.52 = €19.52

### Italia — Regime ordinario (futuro)
- Il terapista addebita IVA 22% ai propri clienti
- Il prezzo del servizio dovrebbe GIA' includere IVA (es. €80 IVA inclusa)
- La piattaforma calcola la commissione sull'imponibile (€80 / 1.22 = €65.57 → 20% = €13.11)
- **Non ancora implementato** — richiede campo `tax_regime` nel profilo terapista

### Estero (non-Italia)
- `ivaApplied = false` — nessuna IVA applicata
- La processing fee (2.5% + €0.25) e' l'unico addebito extra
- Le regole fiscali del paese del terapista si applicano (responsabilita' del terapista)

### Cosa serve per supportare regime ordinario
1. Aggiungere `tax_regime: "forfettario" | "ordinario"` alla tabella `therapist_profiles`
2. Se `ordinario`: aggiungere IVA 22% al prezzo sessione nella UI
3. Calcolare commissione sull'imponibile (prezzo / 1.22)
4. Mostrare breakdown IVA nella ricevuta

---

## 6. Stripe Connect — Destination Charges

### Tipo di integrazione
- **Destination Charges** (non Direct Charges o Separate Charges)
- Il pagamento avviene sull'account della piattaforma
- Stripe trasferisce automaticamente al terapista: `amount - application_fee_amount`

### Flusso Stripe
1. `PaymentIntent` creato con `transfer_data.destination = therapist_connected_account_id`
2. `application_fee_amount = commissione 20% + processing fee 2.5%+€0.25`
3. Stripe addebita la carta del cliente per `totalChargeAmount`
4. Stripe trasferisce `totalChargeAmount - application_fee_amount` al terapista
5. Stripe deduce la sua fee reale dalla `application_fee_amount` della piattaforma

### Account status del terapista
- `not_connected` → non puo' accettare pagamenti
- `onboarding_pending` → in fase di verifica
- `active` → puo' accettare pagamenti (unico stato che permette transazioni)
- `restricted` / `disabled` → pagamenti bloccati

---

## 7. Escrow e payout

### Timing
- **Trasferimento al terapista**: immediato (gestito da Stripe Destination Charges)
- **Escrow interno**: 14 giorni dalla data del pagamento
- **Payout status**: `pending` → `paid` (dopo 14 giorni, aggiornato da `process-pending-payouts`)

### Note
- L'escrow di 14 giorni e' un tracking **interno** per la dashboard guadagni
- I fondi sono GIA' sul connected account del terapista (Stripe li trattiene secondo le sue regole)
- La funzione `process-pending-payouts` aggiorna solo lo status nel DB, NON fa trasferimenti Stripe

---

## 8. Politica di rimborso (v3.1 — tre fasce)

### Regola
| Condizione | Rimborso |
|-----------|----------|
| Cancellazione **≥ 48 ore** prima della sessione | **100%** del prezzo sessione |
| Cancellazione tra **24 e 48 ore** prima | **50%** del prezzo sessione |
| Cancellazione **< 24 ore** prima della sessione | **0%** (nessun rimborso) |

### Flusso rimborso
1. Cliente richiede cancellazione dall'app
2. Edge function `request-refund` calcola la percentuale:
   - `hoursUntilSession = (scheduled_at - now) / 3600`
   - `hoursUntilSession >= 48` → 100%
   - `24 <= hoursUntilSession < 48` → 50%
   - `hoursUntilSession < 24` → 0% (richiesta respinta)
3. Stripe Refund creato per l'importo calcolato (sia sull'importo cliente sia sulla `application_fee` proporzionalmente)
4. Webhook `charge.refunded` aggiorna la transazione:
   - Status: `refunded` (rimborso totale) o `partially_refunded` (50%)
   - `refund_amount`: importo effettivamente rimborsato

### Limiti
- Solo transazioni con status `completed` possono essere rimborsate
- Rate limit: max 3 richieste rimborso per utente per minuto
- Il rimborso NON puo' superare l'importo originale
- Se il terapista cancella, la regola è **sempre 100%** a tutela del cliente (non passa da queste tre fasce — logica separata)

### Booking con credito (pack)
- Nessun rimborso Stripe (prezzo = €0)
- Il credito viene **restituito** (`restore_session_credit` RPC)
- `sessions_remaining` incrementato di 1

---

## 9. Crediti sessione (pack)

### Creazione
- Quando il cliente compra un pack di N sessioni:
  - La prima sessione viene prenotata immediatamente
  - N-1 crediti vengono creati dal webhook (`session_credits` table)
  - `sessions_total = N-1`, `sessions_remaining = N-1`

### Utilizzo
- Il cliente sceglie "Use Session Credit" al momento della prenotazione
- RPC atomico `create_booking_with_credit()`: decrementa credito + crea booking in una transazione
- Booking creato con `price = 0`, `platform_fee = 0`, `therapist_payout = 0`

### Cancellazione
- Se un booking con credito viene cancellato, il credito viene restituito
- `restore_session_credit` RPC: incrementa `sessions_remaining` di 1
- Guard: `sessions_remaining < sessions_total` (non puo' superare il totale)

---

## 10. Valute supportate

| Valuta | Codice | Simbolo |
|--------|--------|---------|
| Euro | EUR | € |
| Dollaro USA | USD | $ |
| Sterlina | GBP | £ |
| Real brasiliano | BRL | R$ |

La valuta e' impostata nel profilo del terapista e usata per tutti i suoi servizi.

---

## 11. Metadata Stripe (per riconciliazione)

Ogni `PaymentIntent` include questi metadata:

| Campo | Esempio | Uso |
|-------|---------|-----|
| `booking_id` | UUID | Link alla prenotazione |
| `client_id` | UUID | Chi ha pagato |
| `therapist_id` | UUID | Chi riceve |
| `connected_account_id` | acct_xxx | Account Stripe terapista |
| `session_price` | 8000 (cents) | Prezzo sessione |
| `commission_base` | 1600 (cents) | 20% commissione |
| `iva_amount` | 0 | IVA (attualmente 0) |
| `iva_applied` | false | Se IVA applicata |
| `service_fee` | 225 (cents) | Processing fee |
| `therapist_country` | IT | Paese terapista |
| `total_charged` | 8225 (cents) | Totale addebitato |
| `service_id` | UUID | Servizio prenotato |
| `pack_size` | 4 | Dimensione pack (0 se singola) |
| `pack_sessions_remaining` | 3 | Crediti da creare |

---

## 12. Problemi noti e correzioni necessarie

### DA CORREGGERE (V1.1)

1. ~~**Costanti legacy nel codice**~~ — **VERIFICATO 2026-04-16**: `SERVICE_FEE_PERCENT` (2.9%) e `SERVICE_FEE_FIXED` (€0.30) non esistono più in `supabase/functions/`. Tutto il calcolo fee usa `STRIPE_PERCENT = 0.025` + `STRIPE_FIXED_CENTS = 25`.

2. **Promo code non attivi in V1**:
   - Il flusso iOS (`validatePromoCode()` in `BookingFlowView.swift:161`) chiama l'edge function `validate-promo` che **non è implementata**.
   - Effetto: `promoDiscount = 0` sempre, nessun sconto applicato.
   - iOS invia `body.price = prezzo intero` e `body.discount = null`. La processing fee è calcolata sul prezzo pieno — coerente con "il cliente paga le fee di Stripe su ciò che paga".
   - Quando il sistema promo verrà attivato (V1.1), bisognerà: (a) creare l'endpoint `validate-promo` che ritorna uno sconto firmato HMAC, (b) aggiornare il validator in `create-booking-with-payment` per riconoscere sconti firmati, (c) assicurare che `sessionPriceCents` nel calcolo fee sia già scontato (il codice attuale usa `body.price` — se iOS invia il prezzo scontato, funziona di default).

3. **Webhook fee reconstruction**: Il webhook `stripe-webhook` ricostruisce le fee dai metadata. Se i metadata contengono il vecchio formato (transazioni pre-refactor), il calcolo potrebbe essere sbagliato per quelle transazioni.

4. **Tariffa Stripe hardcoded UK**: `STRIPE_PERCENT = 2.5%` è la tariffa UK. Carte non-EEA possono costare fino a 4.9% a Stripe — la piattaforma assorbirebbe la differenza. Monitorare via Stripe dashboard. Fix completo = tabella lookup per country (V1.1).

5. **Payout timing — chiarimento**: Il testo "trasferimento immediato" riguarda il `transfer_data.destination` nel PaymentIntent. In realtà Stripe trattiene i fondi sul Connected Account del terapista per **14 giorni** (`delay_days=14`) prima di renderli disponibili per payout. Il terapista vede i fondi come `pending` per 14gg, poi Stripe auto-trasferisce alla banca.

6. **Regime ordinario**: Non supportato. Tutti i terapisti italiani sono trattati come forfettario (IVA non scorporata sulle fatture emesse DA loro, ma la piattaforma scorpora l'IVA sulla PROPRIA fattura di commissione). Servirà il campo `tax_regime` per differenziare (V1.1).

### GIA' IMPLEMENTATO
- Verifica server-side del prezzo (accetta solo single o pack price, no discount V1)
- Idempotency key sui PaymentIntent (`pi-${bookingId}`)
- UNIQUE constraint su `transactions.stripe_payment_intent_id`
- Refund amount validation (bounds check + transaction status)
- Rate limiting su pagamenti e rimborsi
- Refund policy a 3 fasce (48h/24h/0) allineata tra edge function, iOS model e questo doc
