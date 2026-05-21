# Holistic Unity — Complete App Store Submission Walkthrough

> Follow these steps in order. Estimated time: 2-3 hours total.

---

## STEP 1: Deploy Privacy Policy & Support Pages (10 minutes)

Apple requires live URLs for your Privacy Policy and Support page. I've prepared both as ready-to-deploy HTML files in the `holisticunity-site/` folder.

### Quick Deploy via Netlify Drop (free, no account needed):

1. Open **https://app.netlify.com/drop** in your browser
2. Drag the entire `holisticunity-site/` folder from your Holistic Unity Project folder onto the page
3. Wait 10 seconds — Netlify gives you a URL like `https://random-name-12345.netlify.app`
4. Test both pages:
   - `https://YOUR-SITE.netlify.app/privacy/`
   - `https://YOUR-SITE.netlify.app/support/`
5. **Write down your URLs** — you'll need them in Step 4

> **Optional:** Sign up for a free Netlify account to claim a custom subdomain like `holisticunity.netlify.app` instead of the random name. You can also later connect your own domain.

---

## STEP 2: Create a Demo Account for Apple Reviewer (5 minutes)

Apple reviewers MUST be able to log in and test your app. Without a working demo account, your app **will be rejected**.

1. Open your app (or Supabase dashboard)
2. Create a new user account with these credentials:
   - **Email:** `reviewer@holisticunity.app` (or any email you control)
   - **Password:** `HolisticReview2026!` (or any strong password)
3. Log in with this account and make sure:
   - The home screen loads correctly
   - You can browse therapists
   - You can view therapist profiles
   - The booking calendar opens
   - Messages tab is accessible
4. **Write down the email and password** — you'll need them in Step 4

---

## STEP 3: Archive & Upload Build from Xcode (30-45 minutes)

### 3a. Configure Xcode

1. Open your `.xcodeproj` or `.xcworkspace` in Xcode
2. Go to **Target > General** and verify:
   - Display Name: `Holistic Unity`
   - Bundle Identifier: `com.stormxdigital.holisticunity`
   - Version: `1.0.0`
   - Build: `1`
3. Go to **Signing & Capabilities**:
   - Select your Team (from your Apple Developer Account)
   - Check ✅ "Automatically manage signing"
4. In the top bar, select the build target: **Any iOS Device (arm64)**

### 3b. Archive

1. Menu: **Product > Archive**
2. Wait for the build to compile (may take several minutes)
3. The **Organizer** window opens automatically when done

### 3c. Upload to App Store Connect

1. In the Organizer, select your archive
2. Click **"Distribute App"**
3. Select **"App Store Connect"** > Click **Next**
4. Select **"Upload"** > Click **Next**
5. Leave all default options checked (Include bitcode, Upload symbols)
6. Click **Upload**
7. Wait for processing — this takes 15-30 minutes
8. Check your email — Apple will notify you if there are any issues

> **If you get signing errors:** Go to Xcode > Settings > Accounts, make sure your Apple ID is listed and your team has valid certificates. Click "Download Manual Profiles" if needed.

---

## STEP 4: Fill in App Store Connect (45-60 minutes)

### 4a. Create the App (if not already done)

1. Go to **https://appstoreconnect.apple.com**
2. Sign in with your Apple ID
3. Click **"Apps"** > Click the **"+"** button > **"New App"**
4. Fill in:

| Field | Value |
|---|---|
| Platform | iOS |
| Name | `Holistic Unity` |
| Primary Language | English (U.S.) |
| Bundle ID | `com.stormxdigital.holisticunity` |
| SKU | `HOLISTICUNITY2026` |
| User Access | Full Access |

5. Click **Create**

### 4b. App Information

Go to **App Information** in the left sidebar:

| Field | Value |
|---|---|
| Subtitle | `Find Your Wellness Therapist` |
| Primary Category | Health & Fitness |
| Secondary Category | Lifestyle |
| Content Rights | Does not contain third-party content |

### 4c. Pricing and Availability

Go to **Pricing and Availability**:
- Price: **Free**
- Availability: **All territories** (or select specific countries)

### 4d. App Privacy

Go to **App Privacy**:
1. Click **"Get Started"** on the privacy questionnaire
2. For each data type, answer as follows:

**YES — we collect these:**
- Email Address → Linked to Identity → App Functionality, Authentication
- Name → Linked to Identity → App Functionality
- Phone Number → Linked to Identity → App Functionality
- Photos or Videos → Linked to Identity → App Functionality
- Precise Location → Linked to Identity → App Functionality
- Other User Content (Chat Messages) → Linked to Identity → App Functionality

**Tracking:** Select "No" for tracking

### 4e. Version Information (iOS App section)

This is the main submission page. Go to your app version (1.0):

**Screenshots:**
Upload screenshots from the `App Store Screenshots/` folder. You need:
- **iPhone 6.9" Display** (iPhone 16 Pro Max) — upload at least 3
- **iPhone 6.5" Display** (iPhone 11 Pro Max) — upload at least 3

Recommended upload order:
1. `02_Browse_Therapists.png` — Therapist directory
2. `03_Therapist_Profile.png` — Profile detail
3. `05_Book_Session.png` — Booking calendar
4. `01_Home_Dashboard.png` — Home screen
5. `08_Settings_Profile.png` — Settings
6. `10_Category_Sound_Healing.png` — Category page

> **Note:** Your screenshots are from iPhone 17 simulator. For the 6.5" slot, try uploading the same images — App Store Connect may accept them or scale them. If rejected, re-capture at 1242x2688 using iPhone 11 Pro Max simulator in Xcode.

**Description — copy-paste this:**

```
Discover and book holistic wellness practitioners in your area or online. Holistic Unity connects you with verified therapists across yoga, meditation, massage, nutrition, life coaching, and more.

Key Features:
- Browse verified therapist profiles with real reviews and ratings
- Book virtual or in-person sessions in just a few taps
- Chat directly with your therapist before and after sessions
- Manage all your bookings and session history in one place
- Choose from dozens of wellness categories

Whether you're looking for a yoga instructor, a nutritionist, or a life coach, Holistic Unity makes finding the right practitioner simple and secure.
```

**Promotional Text — copy-paste this:**

```
Your wellness journey starts here. Browse verified therapists, book sessions, and connect with holistic practitioners — all in one app.
```

**Keywords — copy-paste this:**

```
therapy,wellness,holistic,yoga,meditation,massage,booking,therapist,health,coaching,mindfulness
```

**What's New — copy-paste this:**

```
Welcome to Holistic Unity! This is our first release. Browse therapists, book sessions, and start your wellness journey today.
```

**Support URL:** `https://serene-peony-6f4851.netlify.app/support/`
**Marketing URL:** `https://serene-peony-6f4851.netlify.app/` (optional)

**Build:** Select the build you uploaded in Step 3

### 4f. App Review Information

Scroll down to **App Review Information**:

**Contact Info:**
| Field | Value |
|---|---|
| First Name | Armand |
| Last Name | [Your Last Name] |
| Phone | [Your Phone] |
| Email | Armand@stormxdigital.com |

**Demo Account:**
| Field | Value |
|---|---|
| Username | [Demo email from Step 2] |
| Password | [Demo password from Step 2] |

**Notes — copy-paste this:**

```
Holistic Unity is a marketplace for booking holistic wellness services (yoga, massage, nutrition, life coaching) with verified practitioners. Sessions are real-world services delivered either in-person or via video call. No digital content is sold within the app. Payments for sessions will be handled externally in a future update.

For testing, you can:
1. Browse therapist profiles in the Explore tab
2. View therapist details including services, pricing, certifications, and reviews
3. Use the booking calendar to select dates and available times
4. Access the Messages tab for direct therapist communication
5. View and manage bookings in the Bookings tab
6. Explore wellness categories (Sound Healing, Astrology, Reiki, etc.)

Demo account credentials are provided above.

Regarding Apple Guidelines:
- Guideline 3.1.1 (In-App Purchase): All sessions are real-world services (in-person or video call), not digital content. Payment processing is handled externally.
- Guideline 1.2 (User Generated Content): Reviews include a Report/Flag feature for content moderation.
- Guideline 5.1.1 (Data Collection): The app collects only data necessary for functionality. Full details are in our Privacy Policy.
```

### 4g. Age Rating

Complete the **Age Rating** questionnaire:
- Answer **"None"** to all content categories (violence, profanity, etc.)
- This should give you a **4+** rating

### 4h. Privacy Policy URL

In **App Information > General Information**:
- **Privacy Policy URL:** `https://serene-peony-6f4851.netlify.app/privacy/`

---

## STEP 5: Submit for Review

1. Go back to your app version page
2. Verify all sections show ✅ green checkmarks
3. Click **"Add for Review"**
4. Click **"Submit to App Review"**
5. Your app status changes to **"Waiting for Review"**

### Expected Timeline:
- First review: **1-7 days** (usually 1-3 for most apps)
- If rejected: Fix issues and resubmit (no additional wait penalty)

---

## Common Rejection Reasons to Avoid

1. **Crash on launch** — Test on real devices via TestFlight first
2. **No demo account** — Always provide working login credentials
3. **Broken links** — Make sure privacy/support URLs are live
4. **Placeholder content** — No "lorem ipsum" or "coming soon" in the app
5. **Missing Report button** — User-generated content (reviews) must have a flag/report option
6. **Account deletion** — Apple requires a way to delete accounts in Settings
7. **References to other platforms** — Remove any mention of "Android" or "Google Play"

---

## Files Ready in Your Folder

| File | Purpose |
|---|---|
| `App Store Screenshots/` | All 11 renamed screenshots + app icon |
| `holisticunity-site/` | Ready to drag onto Netlify Drop |
| `App_Store_Metadata.md` | All metadata fields for quick reference |
| `App_Review_Notes.md` | Reviewer notes to copy-paste |
| `Pre_Submission_Checklist.md` | Final checklist before submitting |
| `privacy-policy.html` | Privacy Policy (also in holisticunity-site/) |
| `support.html` | Support page (also in holisticunity-site/) |

---

*Prepared by Claude for StormX Digital — March 21, 2026*
