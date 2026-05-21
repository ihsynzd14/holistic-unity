# Therapist Onboarding Flow — Xcode Implementation Prompt

## Context for AI Assistant / Developer

You are building the therapist onboarding flow for **Holistic Unity**, a holistic wellness marketplace iOS app built in SwiftUI. The app connects clients with verified therapists for online video sessions. The company operating the platform is an **Italian SRL** that collects payments on behalf of therapists (mandato con rappresentanza) and pays out bi-weekly, retaining a 20% commission.

Therapists can be based in **Italy, the UK, any EU country, or the United States**. The onboarding flow must collect all legal, tax, and banking information needed to:
1. Verify the therapist's identity and professional status
2. Issue commission invoices to the therapist
3. Process bi-weekly payouts in the therapist's local currency
4. Comply with Italian, EU, UK, and US tax reporting requirements

---

## Brand Design Tokens

```
Berry:       #8B2252 (primary buttons, headers)
Gold:        #C9A96E (accents, highlights, progress indicators)
Cream:       #FDF6F0 (backgrounds)
Soft Pink:   #F0DFE5 (card backgrounds, secondary surfaces)
Charcoal:    #2D2D2D (body text)
Font:        System default (San Francisco)
Corner Radius: 16pt for cards, 12pt for inputs
```

---

## Onboarding Flow Structure

The onboarding is a **multi-step wizard** with a progress bar at the top. The therapist can save and resume at any step. All data is saved to Supabase in a `therapist_profiles` table (and related tables) as the therapist progresses.

### Step 1: Personal Information

**Purpose:** Collect basic identity and contact info.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| First Name | Text | Yes | |
| Last Name | Text | Yes | |
| Date of Birth | Date Picker | Yes | Must be 18+ |
| Email Address | Email | Yes | Pre-filled from auth, editable |
| Phone Number | Phone (with country code picker) | Yes | Use international format with flag selector |
| Country of Residence | Dropdown | Yes | Determines which tax fields appear in Step 3. Options: Italy, United Kingdom, + all EU countries, United States |
| City | Text | Yes | |
| Full Address | Text | Yes | Street, number, postal code |
| Profile Photo | Image Upload | Yes | Min 400x400px, crop to circle |
| Short Bio | TextEditor (multiline) | Yes | Max 500 characters. Placeholder: "Tell clients about your approach, training, and what makes your sessions unique..." |

---

### Step 2: Professional Details

**Purpose:** Collect therapy categories, qualifications, and session details.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Therapy Categories | Multi-select chips | Yes (min 1) | Options: ThetaHealing, Family Constellation, Systemic Constellation, Reiki a Distanza, Naturopathy, Astrology, Human Design, Numerology, Ayurveda |
| Years of Experience | Stepper or Dropdown | Yes | 1–40+ |
| Certifications / Qualifications | Text + File Upload (repeatable) | Yes (min 1) | Each entry: Certification Name (text) + Issuing Body (text) + Upload PDF/image of certificate. Allow adding multiple. |
| Languages Spoken | Multi-select | Yes (min 1) | Common options: Italian, English, Spanish, French, German, Portuguese, Dutch, other |
| Session Duration Options | Multi-select | Yes (min 1) | 30 min, 45 min, 60 min, 90 min |
| Session Price | Currency input per duration | Yes | Currency auto-set based on Country of Residence (EUR for Italy/EU, GBP for UK, USD for US). Therapist sets price per duration they selected. |
| Availability | Weekly calendar grid | Yes | Therapist selects available time blocks. Store in UTC, display in therapist's local timezone. |

---

### Step 3: Tax & Legal Information

**Purpose:** Collect all tax identification needed for invoicing and compliance. **This step is CONDITIONAL based on Country of Residence selected in Step 1.**

#### 3A — If Country = Italy

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Business Type | Segmented Control | Yes | Options: "Libero Professionista (Freelancer)" / "Ditta Individuale" / "Società (SRL/SAS/SNC)" |
| Codice Fiscale | Text (16 chars, alphanumeric) | Yes | Validate format: 6 letters + 2 digits + 1 letter + 2 digits + 1 letter + 3 digits + 1 letter |
| Partita IVA | Text (11 digits) | Yes | Prefix display with "IT". Validate: exactly 11 digits. Optionally verify via EU VIES API. |
| Regime Fiscale | Dropdown | Yes | Options: "Regime Ordinario", "Regime Forfettario", "Regime dei Minimi" |
| Codice SDI (Destinatario) | Text (7 chars) | Yes | For receiving electronic invoices. Default suggestion: "0000000" if they use PEC instead. |
| PEC (Certified Email) | Email | Yes | Must end in common PEC domains or any valid email format |
| Professional Register | Text | Optional | If enrolled in an Albo Professionale (e.g., naturopaths in some regions) |
| Ritenuta d'Acconto | Toggle | Conditional | Show only if Business Type = "Libero Professionista". Ask: "Is your activity subject to ritenuta d'acconto?" Default: Yes for ordinario, No for forfettario. |
| IVA Exempt (Art. 10) | Toggle | Optional | "Are your services exempt from IVA under Article 10 DPR 633/72?" Show info tooltip explaining healthcare exemption. |

#### 3B — If Country = Any EU Country (except Italy)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Business Type | Segmented Control | Yes | "Sole Trader / Freelancer" / "Registered Company" |
| VAT Number | Text | Conditional | Required if VAT-registered. Format: 2-letter country prefix + number (e.g., DE123456789, FR12345678901, ES12345678A). Validate via EU VIES API. |
| Tax Identification Number | Text | Yes | National tax ID. Label adapts per country: Germany = "Steuernummer", France = "Numéro SIRET", Spain = "NIF/CIF", Netherlands = "BSN", etc. |
| VAT Registered? | Toggle | Yes | If No, VAT Number field is hidden. Show note: "If you are not VAT-registered, reverse charge will not apply. Please confirm with your local tax advisor." |
| Business Registration Number | Text | Conditional | Required if Business Type = "Registered Company" |
| Country of Tax Residence | Auto-filled | Yes | From Step 1, but allow override if different |

#### 3C — If Country = United Kingdom

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Business Type | Segmented Control | Yes | "Sole Trader" / "Limited Company (Ltd)" / "Partnership" |
| UTR (Unique Taxpayer Reference) | Text (10 digits) | Yes | HMRC tax reference |
| National Insurance Number | Text | Conditional | Required if Sole Trader. Format: 2 letters + 6 digits + 1 letter (e.g., QQ123456C) |
| Company Number | Text (8 chars) | Conditional | Required if Limited Company. Companies House registration. |
| VAT Number | Text | Conditional | Format: GB + 9 digits (e.g., GB123456789). Only if VAT-registered (threshold £90,000/year as of 2025). |
| VAT Registered? | Toggle | Yes | If No, hide VAT Number field. |
| HMRC Self-Assessment Registered? | Toggle | Yes | Informational — remind them they need to report this income. |

#### 3D — If Country = United States

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Business Type | Segmented Control | Yes | "Sole Proprietor" / "LLC" / "Corporation (S-Corp/C-Corp)" |
| EIN (Employer Identification Number) | Text (9 digits, format XX-XXXXXXX) | Conditional | Required if LLC or Corporation. |
| SSN (Social Security Number) | Text (9 digits, format XXX-XX-XXXX) | Conditional | Required if Sole Proprietor without EIN. **SENSITIVE: mask input, encrypt at rest.** |
| State of Residence | Dropdown | Yes | All 50 states + DC + territories |
| W-8BEN Status | Info Card | Yes | Display informational card: "As a US-based therapist receiving payments from an Italian company, you may need to complete a W-8BEN or W-9 form. We will provide this during your first payout cycle." Allow PDF upload if they already have one. |
| W-8BEN / W-9 Upload | File Upload (PDF) | Optional | Allow pre-upload. Mark profile as "tax form pending" if not uploaded — trigger reminder before first payout. |
| Sales Tax Nexus | Toggle | Optional | "Do you collect sales tax on your services?" Informational only — the SRL does not withhold US taxes. |

---

### Step 4: Banking & Payout Details

**Purpose:** Collect bank details for bi-weekly payouts. Fields adapt based on country.

#### Universal Fields (all countries)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Account Holder Name | Text | Yes | Must match legal name or business name |
| Payout Currency | Auto-set, display only | Yes | EUR (Italy/EU), GBP (UK), USD (US) |
| Payout Schedule | Info display | — | "Payouts are processed bi-weekly (1st and 15th of each month). Your first payout will be processed after your profile is verified and you complete your first session." |

#### 4A — If Country = Italy or EU

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| IBAN | Text | Yes | Validate format per country (IT = IT + 2 check + 1 letter + 5 digits + 5 digits + 12 chars = 27 chars total). Show country flag based on IBAN prefix. |
| BIC / SWIFT Code | Text (8 or 11 chars) | Yes | Auto-lookup from IBAN if possible. |
| Bank Name | Text | Optional | Auto-fill from BIC if possible, otherwise manual entry. |

#### 4B — If Country = United Kingdom

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Sort Code | Text (6 digits, format XX-XX-XX) | Yes | UK bank identifier |
| Account Number | Text (8 digits) | Yes | UK bank account |
| IBAN | Text | Optional | UK IBANs exist (GB + 2 check + 4 letter bank code + 6 digit sort + 8 digit account = 22 chars) but sort code + account number is more common domestically. |
| BIC / SWIFT Code | Text | Optional | For international transfers, auto-derive if possible. |
| Bank Name | Text | Optional | |

#### 4C — If Country = United States

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Bank Name | Text | Yes | |
| Routing Number (ABA) | Text (9 digits) | Yes | Validate with checksum algorithm. |
| Account Number | Text | Yes | Typically 10-12 digits. **Mask input.** |
| Account Type | Segmented Control | Yes | "Checking" / "Savings" |
| Wise / Payoneer Account | Text | Optional | Alternative: "If you prefer to receive EUR payouts via Wise or Payoneer, enter your Wise email or Payoneer ID." This avoids FX fees for the SRL. |

---

### Step 5: Legal Agreements & Verification

**Purpose:** Consent, terms acceptance, and identity verification.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Terms of Service | Checkbox + link to PDF | Yes | "I have read and agree to the Holistic Unity Terms of Service for Therapists" |
| Commission Agreement | Checkbox + expandable summary | Yes | "I agree that Holistic Unity will retain a 20% commission on each session booked through the platform. Payouts of the remaining 80% are processed bi-weekly." Show summary of mandato con rappresentanza terms. |
| Privacy Policy (GDPR) | Checkbox + link | Yes | "I consent to the processing of my personal data as described in the Privacy Policy, in compliance with GDPR (EU 2016/679)." |
| Data Processing Agreement | Checkbox | Yes | For therapists who will handle client data during sessions. |
| Identity Verification | File Upload | Yes | Upload a government-issued ID (passport, national ID card, or driver's license). Front + Back if applicable. Mark as "pending review" — admin manually verifies. |
| Selfie Verification | Camera capture | Optional but recommended | Take a selfie holding their ID. Adds trust layer for clients. |
| Electronic Signature | Signature pad or typed name | Yes | "By signing below, I confirm that all information provided is accurate and complete." Capture as image, store with timestamp. |

---

### Step 6: Review & Submit

**Purpose:** Let the therapist review all entered information before submitting.

Display a summary card for each step (collapsible sections):
- Personal info summary
- Professional details summary
- Tax information summary (partially masked — e.g., Partita IVA: IT•••••••89)
- Banking details summary (masked — IBAN: IT60X054•••••••••0000)
- Agreements: all checked

**Submit button:** "Submit for Verification"

**Post-submit screen:** "Thank you! Your profile is under review. We typically verify new therapists within 48 hours. You'll receive an email at [their email] once your profile is approved and you can start accepting bookings."

---

## Supabase Data Model Suggestion

```sql
-- Core therapist profile
CREATE TABLE therapist_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- Step 1: Personal
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  country_code TEXT NOT NULL,        -- ISO 3166-1 alpha-2 (IT, GB, US, DE, etc.)
  city TEXT NOT NULL,
  full_address TEXT NOT NULL,
  profile_photo_url TEXT,
  bio TEXT,

  -- Step 2: Professional
  categories TEXT[] NOT NULL,         -- Array of category slugs
  years_experience INT NOT NULL,
  languages TEXT[] NOT NULL,
  session_durations INT[] NOT NULL,   -- Array of minutes [30, 60, 90]

  -- Step 3: Tax (universal)
  business_type TEXT NOT NULL,        -- 'freelancer', 'sole_trader', 'company', 'llc', etc.

  -- Step 3: Tax (Italy-specific)
  codice_fiscale TEXT,
  partita_iva TEXT,
  regime_fiscale TEXT,                -- 'ordinario', 'forfettario', 'minimi'
  codice_sdi TEXT,
  pec_email TEXT,
  professional_register TEXT,
  ritenuta_acconto BOOLEAN,
  iva_exempt_art10 BOOLEAN,

  -- Step 3: Tax (EU-specific)
  vat_number TEXT,                    -- With country prefix
  tax_id_number TEXT,                 -- National tax ID
  vat_registered BOOLEAN,
  business_registration_number TEXT,

  -- Step 3: Tax (UK-specific)
  utr TEXT,                           -- Unique Taxpayer Reference
  national_insurance_number TEXT,
  company_number TEXT,
  hmrc_self_assessment BOOLEAN,

  -- Step 3: Tax (US-specific)
  ein TEXT,                           -- Encrypted
  ssn_encrypted TEXT,                 -- Encrypted at rest, never exposed in API
  us_state TEXT,
  w8ben_uploaded BOOLEAN DEFAULT FALSE,
  w8ben_url TEXT,

  -- Step 4: Banking
  account_holder_name TEXT,
  payout_currency TEXT,               -- EUR, GBP, USD
  iban TEXT,                          -- Encrypted
  bic_swift TEXT,
  bank_name TEXT,
  uk_sort_code TEXT,                  -- Encrypted
  uk_account_number TEXT,             -- Encrypted
  us_routing_number TEXT,             -- Encrypted
  us_account_number TEXT,             -- Encrypted
  us_account_type TEXT,               -- 'checking' or 'savings'
  wise_payoneer_id TEXT,

  -- Step 5: Legal
  terms_accepted BOOLEAN DEFAULT FALSE,
  terms_accepted_at TIMESTAMPTZ,
  commission_agreed BOOLEAN DEFAULT FALSE,
  commission_agreed_at TIMESTAMPTZ,
  privacy_accepted BOOLEAN DEFAULT FALSE,
  gdpr_consent_at TIMESTAMPTZ,
  id_document_url TEXT,               -- Stored in Supabase Storage, restricted bucket
  selfie_url TEXT,
  signature_url TEXT,
  signature_at TIMESTAMPTZ,

  -- Status & metadata
  onboarding_step INT DEFAULT 1,     -- Track progress (1-6)
  verification_status TEXT DEFAULT 'pending',  -- 'pending', 'in_review', 'approved', 'rejected'
  verification_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session pricing (separate table for flexibility)
CREATE TABLE therapist_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id UUID REFERENCES therapist_profiles(id) NOT NULL,
  duration_minutes INT NOT NULL,
  price_amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL,
  UNIQUE(therapist_id, duration_minutes)
);

-- Certifications (repeatable entries)
CREATE TABLE therapist_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id UUID REFERENCES therapist_profiles(id) NOT NULL,
  certification_name TEXT NOT NULL,
  issuing_body TEXT NOT NULL,
  document_url TEXT,                  -- Uploaded PDF/image
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Availability (weekly recurring slots)
CREATE TABLE therapist_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id UUID REFERENCES therapist_profiles(id) NOT NULL,
  day_of_week INT NOT NULL,           -- 0=Monday, 6=Sunday
  start_time TIME NOT NULL,           -- In UTC
  end_time TIME NOT NULL,             -- In UTC
  timezone TEXT NOT NULL,             -- IANA timezone string
  UNIQUE(therapist_id, day_of_week, start_time)
);

-- Enable Row Level Security
ALTER TABLE therapist_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapist_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapist_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapist_availability ENABLE ROW LEVEL SECURITY;

-- Therapists can only read/write their own data
CREATE POLICY "Therapists manage own profile"
  ON therapist_profiles FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Therapists manage own pricing"
  ON therapist_pricing FOR ALL
  USING (therapist_id IN (
    SELECT id FROM therapist_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Therapists manage own certifications"
  ON therapist_certifications FOR ALL
  USING (therapist_id IN (
    SELECT id FROM therapist_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Therapists manage own availability"
  ON therapist_availability FOR ALL
  USING (therapist_id IN (
    SELECT id FROM therapist_profiles WHERE user_id = auth.uid()
  ));
```

---

## Validation Rules Summary

| Field | Validation |
|-------|-----------|
| Codice Fiscale (IT) | 16 chars, pattern: `^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$` |
| Partita IVA (IT) | 11 digits, prefix "IT" for display |
| EU VAT Number | Country prefix (2 letters) + 8-12 digits. Verify via VIES API: `https://ec.europa.eu/taxation_customs/vies/` |
| UK NI Number | Pattern: `^[A-CEGHJ-PR-TW-Z]{2}[0-9]{6}[A-D]$` |
| UK Sort Code | 6 digits, format XX-XX-XX |
| US EIN | 9 digits, format XX-XXXXXXX |
| US SSN | 9 digits, format XXX-XX-XXXX. MUST be masked in UI and encrypted. |
| US Routing | 9 digits, validate with ABA checksum |
| IBAN | Validate length per country + mod-97 check |
| BIC/SWIFT | 8 or 11 alphanumeric chars |
| Phone | E.164 format with country code |
| Email | Standard RFC 5322 |
| PEC (IT) | Valid email format (typically @pec.it, @legalmail.it, etc.) |

---

## UX Notes

1. **Progress bar** at top shows steps 1-6 with gold (#C9A96E) fill for completed steps, berry (#8B2252) for current step.
2. **Save & Continue Later** button on every step. Data persists to Supabase immediately on field blur or step navigation.
3. **Conditional rendering** is key — Step 3 shows completely different fields based on country. Use a `@ViewBuilder` approach or separate sub-views per country.
4. **Sensitive fields** (SSN, account numbers) must use `.textContentType(.none)` and `SecureField` or masked `TextField`. Never log these values.
5. **Tooltips / info buttons** next to unfamiliar fields (Codice SDI, UTR, W-8BEN) with short explanations in a popover.
6. **Error states** should be inline (red border + message below field), not alert dialogs.
7. **Cream (#FDF6F0) background** for the entire flow, **Soft Pink (#F0DFE5) cards** for each field group, **Berry buttons**, **Gold accents** on progress indicators.
8. **File uploads** use Supabase Storage. Put ID documents in a restricted bucket with admin-only read access.
9. **The review screen (Step 6)** should partially mask sensitive data and allow the therapist to tap any section to jump back and edit.
10. **After submission**, disable editing of tax/banking fields until admin unlocks them (to prevent changes between verification and first payout).
