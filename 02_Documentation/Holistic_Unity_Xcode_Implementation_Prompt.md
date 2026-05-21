# Holistic Unity — Quality Assurance Checklist Prompt

> **How to use:** Paste this prompt into your Xcode AI assistant at the start of a session. It describes quality standards and user experience requirements that the Holistic Unity app must meet, based on a competitive analysis of known failure points in the market. Each item describes a PROBLEM TO AVOID and the ACCEPTANCE CRITERIA your app must satisfy. Do NOT introduce new features, change the existing business model, or add third-party dependencies. Work only within the app's existing architecture and feature set.

---

## IMPORTANT CONSTRAINTS

- **Business model:** Holistic Unity does NOT have subscriptions. The platform earns a percentage of each completed session. Do not introduce subscription plans, monthly billing, or recurring charges to users.
- **No software suggestions:** Do not recommend, import, or integrate any specific third-party SDKs, libraries, or services. Use whatever is already in the project.
- **Preserve existing features:** This prompt is a quality checklist, not a feature spec. Do not redesign existing screens or change navigation unless explicitly asked. Only ensure the listed quality criteria are met within the app's current design.
- **Reference by ID:** Each item has a unique ID (e.g., SR-01). You can be asked to work on specific items like "Check SR-01 compliance."

---

## MODULE 1: VIDEO SESSION RELIABILITY (CRITICAL)

Competitor apps fail catastrophically during video sessions. Holistic Unity must guarantee stable, recoverable sessions.

### SR-01 — Session Crash Recovery
**Problem to avoid:** App crashes during active video sessions with no way to resume.
**Acceptance criteria:**
- Session state (session ID, participant IDs, timestamp) is persisted before a session begins
- If the app relaunches after an unexpected termination during an active session, it detects the interrupted session and prompts the user to rejoin
- Automatic reconnection attempts occur with progressive backoff before giving up
- Session health is monitored (network quality, device performance) and the user is warned proactively if conditions degrade, with an option to switch to audio-only

### SR-02 — Pre-Session Connectivity Verification
**Problem to avoid:** Sessions begin with no audio or video, and users have no way to diagnose why.
**Acceptance criteria:**
- Before each session starts, the app verifies: camera permission, microphone permission, camera produces frames (live preview shown), microphone captures audio (level indicator shown), and network connectivity is sufficient
- Each check shows a clear pass/fail indicator with a plain-language fix suggestion if it fails
- User can re-run the test, switch to audio-only, or proceed anyway

### SR-03 — Ghost Connection Detection
**Problem to avoid:** Both participants appear "connected" but cannot see or hear each other.
**Acceptance criteria:**
- After connection is established, a mutual heartbeat confirms both sides are actually sending and receiving media
- If the heartbeat fails (e.g., 3 consecutive missed pings), the app displays a connection issue banner and attempts automatic recovery
- If recovery fails, the user is offered a fallback option (e.g., phone call, retry, or reschedule)
- All connectivity events are logged for post-session diagnostics

---

## MODULE 2: PAYMENT TRANSPARENCY (CRITICAL)

Competitor users report being charged for sessions that never happened and having no visibility into their payment history.

### BL-01 — Clear Payment History
**Problem to avoid:** Users are charged with no way to see what they were charged for.
**Acceptance criteria:**
- A payment history screen exists showing every transaction with: date, amount, which session it corresponds to (therapist name and session date/time), and status (completed, missed, refunded, failed)
- If a session had technical issues (detected by session health monitoring), the entry is flagged and an easy path to request resolution is available

### BL-02 — Automatic Issue Detection for Failed Sessions
**Problem to avoid:** Users pay for sessions that were broken by platform issues and must fight for resolution.
**Acceptance criteria:**
- If a session had less than 2 minutes of actual connected time AND the user attempted to join, the system automatically flags the session as a technical failure
- The user is notified that the issue was detected and informed of next steps (credit restored, support ticket created, etc.)
- This happens proactively — the user should not need to report it themselves

### BL-03 — Upfront Pricing Clarity
**Problem to avoid:** Users feel misled because costs, fees, or session terms are hidden until after they commit.
**Acceptance criteria:**
- Before a user books a session, the full cost is displayed clearly: session price, any platform fee, and total
- Any promotional pricing shows the original price, discounted price, and when the promotion ends
- All payment processing time expectations are communicated (e.g., if a payment method takes time to confirm, the user sees a status tracker and is told when they can book)

---

## MODULE 3: CUSTOMER SUPPORT ACCESSIBILITY (CRITICAL)

Competitor support relies entirely on unresponsive AI bots with no human escalation path. Response times exceed 2 months.

### CS-01 — Reachable Human Support
**Problem to avoid:** Users cannot reach a human being for help; AI chatbots loop without resolution.
**Acceptance criteria:**
- The app has a clearly accessible help/support section (not buried in settings)
- A searchable FAQ or help center addresses the most common questions
- A clear path to contact a human exists and is always visible (not hidden behind multiple bot interactions)
- When waiting for a human response, the user sees estimated wait time or expected response timeframe
- Support hours are clearly displayed

### CS-02 — Persistent Support Tickets
**Problem to avoid:** Support tickets auto-close within minutes, forcing users to restart their complaint.
**Acceptance criteria:**
- Support conversations remain open for a minimum of 7 days before any automatic closure
- Before closing, the system sends a "Is your issue resolved?" follow-up
- Users can reopen a closed ticket without losing context
- If a session had technical issues, a support ticket is pre-populated with diagnostic data so the user doesn't have to describe the problem from scratch

---

## MODULE 4: SCHEDULING & SESSION MANAGEMENT (HIGH)

Competitor users cannot reschedule, miss sessions due to no reminders, and experience booking sync failures.

### SM-01 — Reliable Recurring Bookings
**Problem to avoid:** Recurring session booking feature exists but doesn't actually work.
**Acceptance criteria:**
- If the app offers recurring booking, every scheduled recurrence is actually created on the server and confirmed
- If a recurring slot becomes unavailable (therapist schedule change), the user is notified and offered alternatives
- Recurring bookings sync to the user's device calendar

### SM-02 — Self-Service Rescheduling & Cancellation
**Problem to avoid:** Users cannot cancel or reschedule sessions, even well in advance; must contact unresponsive support.
**Acceptance criteria:**
- Users can reschedule or cancel a session directly in the app without contacting support
- The cancellation/rescheduling policy is visible at booking time and on the session detail screen
- Clear time-based rules are enforced (e.g., free cancellation with sufficient notice, reduced credit for late cancellation)
- After cancellation, confirmation is immediate and visible in the app

### SM-03 — Booking Confirmation Sync
**Problem to avoid:** User sees a confirmed booking but the therapist never receives it.
**Acceptance criteria:**
- A booking is only shown as "confirmed" after the server has acknowledged it AND the therapist has been notified
- If therapist confirmation is required and not received within a reasonable window, the user is notified and offered alternatives
- Both parties receive a confirmation notification

### SM-04 — Session Reminders
**Problem to avoid:** No reminders exist, leading to missed sessions on both sides.
**Acceptance criteria:**
- Push notifications are sent to both user and therapist at configurable intervals before the session (e.g., 24h, 1h, 15min, 5min)
- Users can customize reminder preferences in settings
- Sessions sync to the device calendar with reminders attached
- Email reminders are sent at least 24h before each session

---

## MODULE 5: THERAPIST DISCOVERY (HIGH)

Competitor search overwhelms users with too much information and requires too many steps to book.

### UX-01 — Clear Therapist Profiles
**Problem to avoid:** Therapist search results show too much unstructured information, overwhelming users.
**Acceptance criteria:**
- Therapist profiles in search results are scannable: photo, name, key specialties (as short tags), availability indicator, and a brief bio (1-2 sentences max)
- Detailed information is available on tap but not shown in the list view
- If a matching/recommendation system exists, it surfaces a small number of best matches rather than a long unranked list

### UX-02 — Visible Session Actions
**Problem to avoid:** Session management options (join, reschedule, cancel) are hidden and hard to find.
**Acceptance criteria:**
- The home screen or main tab prominently displays the user's next upcoming session with clear action buttons (join, reschedule, cancel)
- Users do not need to navigate through multiple screens to find basic session actions

### UX-03 — Minimal Booking Friction
**Problem to avoid:** Booking a session requires too many taps and navigation steps.
**Acceptance criteria:**
- From the home screen, a user can reach a confirmed booking in 3 taps or fewer
- Therapist availability is shown visually (calendar or time-slot grid), not as a long scrollable list

---

## MODULE 6: USER ENGAGEMENT & RETENTION (HIGH)

Competitor data shows many users never book their first session, and those who do often don't return.

### UE-01 — First Session Conversion
**Problem to avoid:** Users complete signup but never book their first session.
**Acceptance criteria:**
- The onboarding flow naturally leads to booking a first session (not just account creation)
- If a user exits onboarding without booking, their preferences are saved and the app prompts them to complete booking on next open
- Re-engagement notifications are sent within 24 hours to users who signed up but didn't book

### UE-02 — Post-Session Re-booking
**Problem to avoid:** Users complete a session and the app does nothing to encourage continuity.
**Acceptance criteria:**
- After a session ends, the user is prompted to book their next session with options like "same time next week" or "choose a different time"
- If the app has progress tracking features (mood check-ins, session history, journals), these are visible and easy to access to reinforce the value of continuing

### UE-03 — Therapist Feedback Collection
**Problem to avoid:** No mechanism exists for users to rate or give feedback on sessions.
**Acceptance criteria:**
- After each session, users are prompted for optional private feedback (rating, tags, and/or free-text)
- Feedback is used internally to improve matching and flag quality issues — not displayed publicly
- The feedback prompt is quick (completable in under 15 seconds) and skippable

---

## MODULE 7: TRANSPARENCY & TRUST (MEDIUM)

Competitor users feel misled by hidden terms and have low trust in the platform's credibility.

### PP-01 — No Hidden Terms
**Problem to avoid:** Users discover limitations or costs only after they've committed.
**Acceptance criteria:**
- All session costs, platform fees, and policy details are visible before the user confirms a booking
- If any promotional pricing applies, the terms (duration, what happens after) are stated alongside the price
- No asterisks or "terms apply" links that hide material information

### PP-02 — Payment Method Communication
**Problem to avoid:** Users select a payment method with processing delays and aren't told about the wait.
**Acceptance criteria:**
- If any payment method has a processing delay, the expected timeframe is displayed at the moment of selection
- A status tracker shows payment progress (e.g., Pending → Confirmed → Ready to Book)
- The user receives a notification when payment is confirmed

---

## MODULE 8: UI CONSISTENCY & RESPONSIVENESS (MEDIUM)

Competitor app has inconsistent visual design and unresponsive touch targets.

### UI-01 — Consistent Design Language
**Problem to avoid:** Inconsistent icons, colors, typography, and UI patterns across screens.
**Acceptance criteria:**
- The app uses a centralized design system (color palette, typography scale, spacing scale, icon set) and all screens reference it
- No hardcoded color values, font sizes, or spacing values in individual views
- Icons follow a single consistent style throughout the app

### UI-02 — Reliable Touch Interactions
**Problem to avoid:** Buttons sometimes don't respond to taps, leaving users unsure if their action registered.
**Acceptance criteria:**
- All tappable elements meet the minimum 44x44pt touch target size
- Every button that triggers an async action shows a loading state immediately on tap
- Buttons are disabled during async operations to prevent double-taps
- Haptic feedback confirms button taps on supported devices

---

## MODULE 9: SECURITY & DATA PROTECTION (MEDIUM)

Competitor platform has been flagged with low trust scores by third-party evaluators.

### TS-01 — User Trust Signals
**Problem to avoid:** Users have no visibility into how their sensitive health data is protected.
**Acceptance criteria:**
- A Privacy & Security section in Settings explains in plain language how data is encrypted, stored, and who has access
- Compliance with applicable data protection laws (e.g., LGPD) is stated
- If corporate/employer plans exist, it is explicitly stated that session content is never shared with the employer
- Biometric authentication (Face ID / Touch ID) is available as an option for app access
- All API communication uses secure transport and local sensitive data is encrypted

---

## MODULE 10: PROFESSIONAL (THERAPIST) EXPERIENCE (LOW)

Competitor therapists report dissatisfaction with compensation and platform support, leading to attrition.

### PR-01 — Therapist-Side Quality of Life
**Problem to avoid:** Therapists leave the platform due to poor tools, unclear earnings, or lack of support.
**Acceptance criteria:**
- Therapists have a clear view of their earnings (per session and cumulative)
- Schedule management is flexible and therapist-controlled
- Therapists have access to client session history and their own previous notes for session preparation
- A dedicated support channel exists for professional-side issues

---

## PRIORITY ORDER

When reviewing or implementing, prioritize in this order:

1. Video Session Reliability (Module 1) — core product must work
2. Payment Transparency (Module 2) — users must trust the payment flow
3. Scheduling (Module 4) — sessions must be bookable and manageable
4. Therapist Discovery (Module 5) — users must find the right therapist efficiently
5. Customer Support (Module 3) — catch what the above modules don't prevent
6. User Engagement (Module 6) — retention after core experience is solid
7. Transparency & UI (Modules 7-8) — polish and trust
8. Security & Professional (Modules 9-10) — ongoing improvements

---

*Quality checklist generated from competitive analysis of ZenKlub — March 22, 2026*
