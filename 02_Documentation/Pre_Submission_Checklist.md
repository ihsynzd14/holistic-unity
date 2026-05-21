# Holistic Unity — Pre-Submission Checklist

> Go through every item before clicking "Submit for Review" in App Store Connect.

---

## Account & Configuration

- [ ] Apple Developer Account active and paid ($99/year)
- [ ] Bundle ID registered: `com.stormxdigital.holisticunity`
- [ ] Certificates and Provisioning Profiles configured in Xcode
- [ ] App created in App Store Connect

## Build

- [ ] Build compiles without errors or critical warnings
- [ ] Build uploaded to App Store Connect (Product → Archive → Distribute)
- [ ] Build processed successfully (no error emails from Apple)
- [ ] Tested on TestFlight with real devices
- [ ] No crashes in core flows: browse, profile, booking, chat, settings

## App Icon

- [ ] `AppIcon_1024x1024.png` uploaded (1024x1024 px, PNG, no transparency)
- [ ] Corners NOT pre-rounded (Apple applies the mask automatically)

## Screenshots

- [ ] iPhone 6.9" (16 Pro Max) — minimum 3 screenshots uploaded (1320 x 2868 px)
- [ ] iPhone 6.5" (11 Pro Max) — minimum 3 screenshots uploaded (1242 x 2688 px)
- [ ] Screenshots show real app content (no placeholder data)
- [ ] Consider adding overlay titles for higher conversion

### Recommended upload order:
1. `01_Home_Dashboard.png` — Home screen
2. `02_Browse_Therapists.png` — Therapist directory
3. `03_Therapist_Profile.png` — Profile detail
4. `04_Services_And_Pricing.png` — Services & pricing
5. `05_Book_Session.png` — Booking calendar
6. `08_Settings_Profile.png` — Settings

## Metadata

- [ ] App Name: **Holistic Unity**
- [ ] Subtitle: **Find Your Wellness Therapist** (30 char max)
- [ ] Full description pasted (English)
- [ ] Promotional text filled in
- [ ] Keywords: `therapy,wellness,holistic,yoga,meditation,massage,booking,therapist,health,coaching,mindfulness`
- [ ] What's New text filled in
- [ ] Categories: **Health & Fitness** + **Lifestyle**
- [ ] Content Rating questionnaire completed (4+)

## URLs (Required — Must Be Live)

- [ ] Privacy Policy URL live: `https://holisticunity.app/privacy`
- [ ] Support URL live: `https://holisticunity.app/support`
- [ ] Marketing URL (optional): `https://holisticunity.app`

> Upload `privacy-policy.html` and `support.html` to your website before submitting.

## Privacy & Legal

- [ ] App Privacy questionnaire completed in App Store Connect
- [ ] Data types declared: Email, Name, Phone, Photos, Location, Messages
- [ ] All data marked as "Linked to Identity"
- [ ] Privacy Policy covers Supabase storage and authentication

## Review Preparation

- [ ] Demo account created and working
- [ ] Demo credentials entered in App Review Information
- [ ] Reviewer notes pasted (see `App_Review_Notes.md`)
- [ ] Contact info filled in for review team
- [ ] Report/Flag button visible on user-generated content (reviews)
- [ ] No placeholder text, "coming soon," or "lorem ipsum" visible in the app
- [ ] No references to other platforms (Android, Google Play) visible

## Final Checks

- [ ] App works fully offline or shows graceful error states
- [ ] All links in the app work (no broken URLs)
- [ ] Login/signup flow works end-to-end
- [ ] Account deletion option available in Settings (Apple requirement)
- [ ] App does not crash on any supported iOS version
