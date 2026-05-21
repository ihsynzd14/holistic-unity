# Holistic Unity — Architecture & Tech Stack

## Overview

Holistic Unity is a holistic wellness therapy marketplace iOS app launching May 1, 2026. Clients discover and book sessions with verified holistic therapists (Reiki, yoga, meditation, breathwork, sound healing, etc.) via video or in-person. Therapists onboard, list services, receive bookings, and get paid through Stripe Connect.

**Company:** STORM X DIGITAL S.R.L.
**Contact:** Armand — Armand@stormxdigital.com
**Domain:** holisticunity.app

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| iOS App | Swift / SwiftUI | Native iOS client (Xcode) |
| Backend | Supabase | Auth, PostgreSQL database, Edge Functions, file storage |
| Payments | Stripe Connect Express | Split payments between platform and therapists |
| Video Calls | LiveKit | Real-time video therapy sessions |
| Chat | Stream Chat | Real-time messaging between clients and therapists |
| Push Notifications | APNs | Apple Push Notification service via Supabase Edge Function |
| Website | Static HTML/CSS/JS | Hosted on Vercel at holisticunity.app |
| Error Monitoring | Sentry | Crash and error tracking in iOS app |
| Contact Form | FormSubmit.co | Website contact form → email |
| DNS/Hosting | Vercel | Website deployment and domain management |

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        iOS App (SwiftUI)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Supabase │  │  Stripe  │  │ LiveKit  │  │ Stream Chat │ │
│  │   SDK    │  │   SDK    │  │   SDK    │  │    SDK      │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │              │             │                │        │
└───────┼──────────────┼─────────────┼────────────────┼────────┘
        │              │             │                │
        ▼              ▼             ▼                ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐  ┌──────────────┐
│   Supabase   │ │  Stripe  │ │ LiveKit  │  │ Stream Chat  │
│  ┌────────┐  │ │  API     │ │  Server  │  │   Server     │
│  │  Auth  │  │ └─────┬────┘ └──────────┘  └──────────────┘
│  ├────────┤  │       │
│  │   DB   │  │       │
│  ├────────┤  │       ▼
│  │Storage │  │ ┌──────────────────────────────────┐
│  ├────────┤  │ │   Supabase Edge Functions (8)    │
│  │  Edge  │◄─┤ │                                  │
│  │  Funcs │  │ │  create-connect-account          │
│  └────────┘  │ │  create-payment-intent           │
│              │ │  connect-dashboard                │
│  ┌────────┐  │ │  connect-redirect                │
│  │Triggers│──┤ │  stripe-webhook ◄── Stripe       │
│  │(pg_net)│  │ │  send-push-notification ──► APNs │
│  └────────┘  │ │  livekit-token                   │
│              │ │  stream-token                     │
└──────────────┘ └──────────────────────────────────┘
```

---

## Core Flows

### Payment Flow
1. Client selects a service and time slot → booking created with status `pending`
2. iOS app calls `create-payment-intent` Edge Function → returns Stripe `clientSecret`
3. Client completes payment via Stripe SDK in the app
4. Stripe fires `payment_intent.succeeded` webhook → Edge Function creates `transactions` record, updates booking to `confirmed`
5. Payment method is automatically saved to `payment_methods` table for future use
6. Platform takes 20% fee, therapist receives 80%

### Therapist Onboarding Flow
1. Therapist signs up → `handle_new_user` trigger creates `users` row
2. Therapist fills profile → creates `therapist_profiles` row with `approval_status: "draft"`
3. Therapist submits for review → `approval_status: "pending_review"`
4. Admin approves → `approval_status: "approved"`, `is_approved: true` (via service_role)
5. Therapist sets up payments → iOS app calls `create-connect-account` → opens Stripe Express onboarding
6. Therapist completes Stripe onboarding → `account.updated` webhook updates `stripe_account_status: "active"`
7. Therapist can now receive bookings and payments

### Push Notification Flow
1. App/backend inserts row into `notifications` table
2. Database trigger `send_push_on_notification_insert` fires via `pg_net`
3. Calls `send-push-notification` Edge Function
4. Edge Function looks up device token from `device_tokens` table
5. Sends APNs push notification to the user's iPhone

### Chat Flow
1. Client/therapist opens chat → app calls `get_or_create_conversation()` RPC
2. Messages sent → inserted into `messages` table, `increment_unread_count()` called
3. Stream Chat SDK handles real-time delivery
4. `stream-token` Edge Function provides auth tokens

### Video Session Flow
1. Booking reaches scheduled time → app requests token from `livekit-token` Edge Function
2. Both participants join the LiveKit room for the video therapy session

---

## Brand Guidelines

| Element | Value |
|---|---|
| Berry (Primary) | `#8B2252` |
| Gold (Accent) | `#C9A96E` |
| Cream (Background) | `#FDF6F0` |
| Soft Pink | `#F0DFE5` |
| Charcoal (Text) | `#2D2D2D` |
| Display Font | Cormorant Garamond |
| Body Font | Inter |
