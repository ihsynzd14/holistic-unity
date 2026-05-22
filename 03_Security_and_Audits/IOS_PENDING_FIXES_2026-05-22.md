# Holistic Unity iOS — Fix list pending QA device (2026-05-22)

**Scope**: consolidato dei due audit eseguiti il 2026-05-21 e 2026-05-22 sulle task `@MainActor` e `try? await` del [01_TASK_LIST_PRELANCIO.md](../01_START_HERE/01_TASK_LIST_PRELANCIO.md).
**Vincolo**: dev environment Windows 11, nessun device iOS disponibile. Tutti i fix qui sotto sono **deferred** finché non è possibile testare su device fisico.
**Outcome dell'audit**: 82 file rivisti totali, **6 fix proposti** (3 critici + 3 alti) + 4 minori opzionali + 1 cosmetico da NON fare.

---

## TL;DR — Quanto è importante ogni fix

| Tier | Quantità | Soglia decisionale |
|------|----------|---------------------|
| 🔴 **CRITICO** | 3 | Fixa **prima del lancio** se trovi anche solo 1 ora di QA su device. Bug reali, user impact certo. |
| 🟠 **ALTO** | 3 | Fixa **entro 2 settimane dal lancio**. UX degradata o latente che può emergere in produzione. |
| 🟡 **MEDIO** | 4 | Post-lancio. Pattern intenzionali ma migliorabili (telemetria/reconciliation). |
| 🟢 **NON FIXARE** | 1 | Solo cosmetico, refactor di codice funzionante. Rischio > beneficio. |

**Nessuno** dei fix tocca i critical path che la task list nomina esplicitamente (`paymentIntent`, `booking confirm`, `signOut`) — quelli sono **già puliti**, verificato in audit.

---

## 🔴 TIER 1 — CRITICI (fix-before-launch)

### #1. AppCoordinator.swift:32 — Auto-assegnazione ruolo client (caso `.needsRole`)

**Importanza**: 🔴🔴🔴 — il developer di `AuthManager` ha scritto un commento esplicito al [AuthManager.swift:263-265](../08_Codebases/iOS_App/Holistic Unity/Core/Authentication/AuthManager.swift) che dice testualmente "**Do NOT silently swallow** — if this fails the user's role is never saved to DB and they will be stuck in needsRole on every cold launch". Il chiamante **viola** questa regola.

**Codice attuale**:
```swift
case .needsRole:
    LaunchLoadingView()
        .task { try? await authManager.selectRole(.client) }
```

**Impatto utente**: se `selectRole` fallisce silenziosamente (errore di rete, RLS, JWT scaduto), l'utente resta **bloccato su LaunchLoadingView all'infinito** senza retry né messaggio. Il ciclo si ripete ad ogni cold launch perché `authState` non avanza mai a `.needsOnboarding`.

**Fix proposto** (~7 righe):
```swift
case .needsRole:
    LaunchLoadingView()
        .task {
            do {
                try await authManager.selectRole(.client)
            } catch {
                appState.toast = .error(
                    title: "Configurazione account",
                    message: "Riprova fra qualche secondo. Se persiste, contatta il supporto."
                )
            }
        }
```

**Rischio fix senza test**: 🟢 BASSO. Cambio puramente additivo: il happy path resta identico, si aggiunge solo il ramo di errore. Toast esiste già nel design system.

**QA su device**: simula offline (Airplane mode) durante il primo login → l'utente deve vedere il toast e poter ritentare riattivando la rete.

---

### #2. AppCoordinator.swift:58 — Stessa cosa nel fallback `.authenticated`

**Importanza**: 🔴🔴 — stesso pattern, ramo meno frequente (utente loggato ma senza role assegnato, edge case di onboarding interrotto).

**Codice attuale**:
```swift
case .authenticated:
    if authManager.currentUser?.role == .therapist {
        ...
    } else if authManager.currentUser?.role == .client {
        ClientTabView()
    } else {
        LaunchLoadingView()
            .task { try? await authManager.selectRole(.client) }
    }
```

**Impatto utente**: identico a #1 — loop di loading infinito.

**Fix proposto**: identico a #1, stessa toolchain.

**Rischio fix senza test**: 🟢 BASSO.

**QA su device**: corrompi manualmente il role in DB (`UPDATE users SET role = NULL WHERE id = 'reviewer'`), forza un cold launch dell'app e verifica recupero.

---

### #3. SettingsView.swift:1392 — Salvataggio lingua preferita

**Importanza**: 🔴🔴 — l'utente vede la UI chiudersi come se il save fosse riuscito, ma il DB non è aggiornato. Al riavvio dell'app le lingue tornano a quelle vecchie.

**Codice attuale**:
```swift
_ = try? await SupabaseConfig.client
    .from("users")
    .update(LanguageUpdate(
        preferredLanguages: languagesArray,
        updatedAt: ISO8601DateFormatter.shared.string(from: Date())
    ))
    .eq("id", value: userId)
    .execute()

authManager.currentUser?.preferredLanguages = languagesArray
isSaving = false
dismiss()
```

**Impatto utente**: setting "fantasma". Utente cambia lingua di interazione, vede confirmation, chiude. Apre l'app il giorno dopo: lingua sparita. Genera ticket di supporto + sfiducia.

**Fix proposto** (~8 righe):
```swift
do {
    try await SupabaseConfig.client
        .from("users")
        .update(LanguageUpdate(
            preferredLanguages: languagesArray,
            updatedAt: ISO8601DateFormatter.shared.string(from: Date())
        ))
        .eq("id", value: userId)
        .execute()
    authManager.currentUser?.preferredLanguages = languagesArray
    isSaving = false
    dismiss()
} catch {
    isSaving = false
    errorMessage = "Impossibile salvare. Controlla la connessione e riprova."
}
```

**Rischio fix senza test**: 🟢 BASSO. `errorMessage` è già una `@State` della view (controlla `errorMessage` nelle righe precedenti, il pattern esiste già altrove in SettingsView). Pura aggiunta di branch error.

**QA su device**: Airplane mode → cambia lingue → tappa Save → deve apparire errore, non dismiss.

---

## 🟠 TIER 2 — ALTI (fix-entro-due-settimane-dal-lancio)

### #4. SettingsView.swift:973 — Rimozione metodo di pagamento (swipe-to-delete)

**Importanza**: 🟠🟠 — financial state divergence. La card scompare dalla UI ma Stripe la mantiene attiva. Se il backend remove fallisce, l'utente potrebbe ricevere addebiti su una carta che credeva di aver rimosso, oppure vedersela ricomparire al prossimo fetch.

**Codice attuale**:
```swift
private func deleteMethod(at offsets: IndexSet) {
    let methodsToDelete = offsets.map { paymentMethods[$0] }
    paymentMethods.remove(atOffsets: offsets)   // ← rimozione UI ottimistica

    Task {
        for method in methodsToDelete {
            try? await DIContainer.shared.paymentRepository.removePaymentMethod(methodId: method.id)
        }
    }
}
```

**Impatto utente**: addebiti "fantasma" su carta che pensava cancellata + confusione quando la card ricompare dopo un refresh.

**Fix proposto** (~15 righe — richiede design UX):
```swift
private func deleteMethod(at offsets: IndexSet) {
    let methodsToDelete = offsets.map { paymentMethods[$0] }
    let originalMethods = paymentMethods
    paymentMethods.remove(atOffsets: offsets)

    Task {
        var failedMethods: [PaymentMethod] = []
        for method in methodsToDelete {
            do {
                try await DIContainer.shared.paymentRepository.removePaymentMethod(methodId: method.id)
            } catch {
                failedMethods.append(method)
            }
        }
        if !failedMethods.isEmpty {
            // Restore failed methods at the end of the list (order isn't preserved — design tradeoff)
            paymentMethods.append(contentsOf: failedMethods)
            errorMessage = "Alcune carte non sono state rimosse. Riprova."
        }
    }
}
```

**Rischio fix senza test**: 🟡 MEDIO. Tocca array binding (`@State paymentMethods`). Se non restori correttamente l'ordine, la lista mostra le carte in posizione sbagliata. Da testare lo `IndexSet` con selezioni multiple.

**QA su device**: simula 401 Stripe (revoca temporaneamente la chiave API) → tenta swipe-to-delete → la carta deve riapparire con messaggio di errore.

---

### #5. VideoCallService.swift:519 — Flag sessione fallita per refund

**Importanza**: 🟠 — non user-facing, ma il support team perde la capacità di distinguere "no-show legittimo" da "fallimento tecnico". Affecta routing dei refund.

**Codice attuale**:
```swift
_ = try? await SupabaseConfig.client
    .from("bookings")
    .update(FailedFlag(
        technicalFailure: true,
        connectedSeconds: actualConnectedSeconds,
        updatedAt: ISO8601DateFormatter.shared.string(from: Date())
    ))
    .eq("id", value: bookingId)
    .execute()
```

**Impatto utente**: indiretto. Il supporto rifiuta un refund legittimo perché non vede il flag `technical_failure=true` in DB.

**Fix proposto** (~10 righe):
```swift
do {
    try await SupabaseConfig.client
        .from("bookings")
        .update(FailedFlag(...))
        .eq("id", value: bookingId)
        .execute()
} catch {
    // Sentry breadcrumb: il supporto deve poter ricostruire il fallimento dai log anche se il DB write fallisce
    let breadcrumb = Breadcrumb(level: .warning, category: "video.flag_failed")
    breadcrumb.message = "flagSessionAsFailed write failed"
    breadcrumb.data = ["booking_id": bookingId, "connected_seconds": actualConnectedSeconds, "error": error.localizedDescription]
    SentrySDK.addBreadcrumb(breadcrumb)
}
```

**Rischio fix senza test**: 🟢 BASSO. `Sentry` è già wired, `Breadcrumb` è already usato altrove nel codebase (es. [JailbreakDetector.swift:113](../08_Codebases/iOS_App/Holistic Unity/Core/Security/JailbreakDetector.swift)). Nessun cambio di stato visibile all'utente.

**QA su device**: non testabile da UI. Verifica nel Sentry dashboard che il breadcrumb compaia simulando un 500.

---

### #6. PushNotificationService.swift:127-143 — Stream Chat callback fuori da MainActor

**Importanza**: 🟠 — **latente**. Il codice funziona oggi perché lo Stream Chat SDK chiama le completion sul main thread, ma il contratto non è documentato. Se un upgrade SDK cambia questo comportamento, la mutazione di `self.pendingDeviceToken` (line 140) da background thread su una classe `@MainActor` diventa un crash con Swift 6 strict concurrency.

**Codice attuale**:
```swift
func registerTokenWithStreamChat(token: Data) {
    guard StreamChatService.shared.isConnected else { ... }
    StreamChatService.shared.chatClient
        .currentUserController()
        .addDevice(.apn(token: token, providerName: StreamConfig.apnProviderName)) { [self] error in
            if let error {
                logger.error("...")
            } else {
                self.pendingDeviceToken = nil   // ← mutation potenzialmente off-main
            }
        }
}
```

**Impatto utente**: oggi nessuno. Domani: crash al primo register dopo SDK upgrade, oppure runtime warning con Swift 6.

**Fix proposto** (~20 righe — converte 2 metodi in async, aggiorna i ~3 call sites):
```swift
func registerTokenWithStreamChat(token: Data) async {
    guard StreamChatService.shared.isConnected else { ... }
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
        StreamChatService.shared.chatClient
            .currentUserController()
            .addDevice(.apn(token: token, providerName: StreamConfig.apnProviderName)) { error in
                cont.resume()  // resume sempre, error gestito dentro la closure
            }
    }
    // mutazione qui è garantita @MainActor (classe @MainActor + async)
    pendingDeviceToken = nil
}
```

E i call sites diventano `await register...`.

**Rischio fix senza test**: 🟠 MEDIO-ALTO. Le push notification sono "invisible failures" — un missed `await` fa registrare il token "fire-and-forget" e l'utente non vede push. Da testare su device fisico con APNs sandbox attivo. **Per questo motivo l'audit precedente del 2026-05-21 ha esplicitamente raccomandato di NON applicarlo senza device QA.**

**QA su device**: device fisico + TestFlight build + verifica delivery push entro 30s dal login.

---

## 🟡 TIER 3 — MEDI (post-lancio, design decision)

### #7-#10. NotificationManager.swift:82, 97, 108, 120 — Mutazioni notifiche ottimistiche

**Importanza**: 🟡 — pattern intenzionale (UI snappy à la Slack/iMessage). Il problema è che **non c'è telemetria** sui fallimenti: l'utente segna come letto, riavvia, e si ritrova le notifiche unread di nuovo, senza che il dev team lo sappia.

**Codice attuale** (4 occorrenze identiche, qui mostro `markAsRead`):
```swift
func markAsRead(_ notificationId: String) {
    // UI mutation immediata (line 81 prima del Task)
    Task {
        _ = try? await SupabaseConfig.client
            .from(SupabaseConfig.Table.notifications)
            .update(...)
            ...
    }
}
```

**Impatto utente**: confusione quando le notifiche "tornano". Non rompe nulla.

**Fix proposto — opzione A (telemetria, ~3 righe per occorrenza)**:
```swift
Task {
    do {
        _ = try await SupabaseConfig.client.from(...)...
    } catch {
        SentrySDK.addBreadcrumb(...)  // categoria "notifications.optimistic_fail"
    }
}
```

**Fix proposto — opzione B (reconciliation su next refresh)**: re-fetch della lista dopo ogni mutation. Più invasivo, da decidere col team.

**Rischio fix senza test**: opzione A 🟢 basso, opzione B 🟡 medio.

**QA su device**: simula 500 server durante mark-as-read, verifica entry in Sentry.

---

## 🟢 TIER 4 — NON FIXARE (cosmetico, rischio > beneficio)

### #11. SettingsView.swift:1293 — `DispatchQueue.main.async` legacy

Pattern vecchio dentro `LAContext.evaluatePolicy` completion. Funziona perfettamente — il codice arriva sul main thread, lo state mutation è corretto. Un fix sarebbe puro refactoring stilistico (`Task { @MainActor in }`) senza miglioramento funzionale.

**Decisione**: ignorare. Toccare codice biometrico senza poter testare con Face ID/Touch ID enrollato è alto rischio per zero beneficio.

---

## Mappa rischio fix vs beneficio (visiva)

```
                       BENEFICIO
                   BASSO      ALTO
              ┌─────────┬─────────┐
        ALTO  │   #11   │   #6    │
              │  SKIP   │         │   ← richiede device QA serio
RISCHIO       ├─────────┼─────────┤
              │   #7-10 │ #1 #2   │
        BASSO │         │ #3 #4 #5│   ← FIX QUI se hai un'ora di QA
              └─────────┴─────────┘
```

I 5 fix nel quadrante in basso a destra (#1, #2, #3, #4, #5) sono il **massimo ROI** per il pre-lancio.

---

## Cosa è già stato verificato puro

Files che la task list aveva chiamato a sospetto ma che sono risultati **puliti** all'audit:

- `SupabasePaymentRepository.swift` — zero `try? await`, ogni operazione propaga errore. Stripe error mapper in [StripeErrorMapper.swift](../08_Codebases/iOS_App/Holistic Unity/Data/Repositories/StripeErrorMapper.swift) traduce in messaggi italiani.
- `SupabaseBookingRepository.swift` — zero `try? await`.
- `AuthManager.swift signOut()` ([AuthManager.swift:281-309](../08_Codebases/iOS_App/Holistic Unity/Core/Authentication/AuthManager.swift)) — usa il pattern corretto: backend error catturato e loggato, ma local state wipe sempre eseguito (URLCache, UserDefaults, Keychain, Sentry user). Questo è desiderable: il sign-out locale **deve** sempre succedere anche se il backend è down.
- `BookingFlowView.swift validatePromoCode` ([BookingFlowView.swift:175-203](../08_Codebases/iOS_App/Holistic Unity/Features/Booking/BookingFlowView.swift)) — il `try await` è dentro `do/catch` con error message all'utente.
- `ClientOnboardingFlow.swift completeOnboarding` ([ClientOnboardingFlow.swift:304-371](../08_Codebases/iOS_App/Holistic Unity/Features/Onboarding/ClientOnboarding/ClientOnboardingFlow.swift)) — upsert preferenze in `do/catch`, error surfacing corretto.

Tutti i 15 `try? await Task.sleep(...)` nel codebase sono **idiomatici** — `Task.sleep` throw solo su cancellation, e sono sempre dentro guard `Task.isCancelled`.

L'audit `@MainActor` del 2026-05-21 ha confermato che tutti i 31 file rivisti hanno isolamento corretto. **Nessun fix richiesto**.

---

## Riferimenti

- Plan file dettagliato di sessione: `C:\Users\ihsynzd\.claude\plans\foamy-wiggling-treasure.md`
- Task list pre-lancio: [01_TASK_LIST_PRELANCIO.md](../01_START_HERE/01_TASK_LIST_PRELANCIO.md) (linee 45, 50)
- Audit precedente: [AUDIT_REPORT_2026-05-18.md](AUDIT_REPORT_2026-05-18.md)
