# Holistic Unity — Onboarding & Personalization System
## Complete SwiftUI Implementation Prompt

---

> **How to use this:** Copy everything below the horizontal rule and paste it into your AI coding assistant (GitHub Copilot, Cursor, or any AI in Xcode). It will generate all the files you need.

---

## PROMPT — COPY FROM HERE

Build a complete SwiftUI onboarding flow for an iOS app called **Holistic Unity**. The app connects users with holistic and spiritual practitioners across modalities including Theta Healing, Astrology, Numerology, and Human Design. Users range from complete beginners to experienced practitioners.

---

### PART 1 — DATA MODEL

Create a file called `UserProfile.swift`. This is the single source of truth for everything captured during onboarding. It must be an `ObservableObject` stored in the app's environment.

```swift
// UserProfile.swift
// Stores all onboarding data and drives personalization throughout the app.
```

The model must include:

- `name: String` — user's first name
- `experienceLevel: ExperienceLevel` — enum with cases: `.curious` (beginner), `.exploring` (intermediate), `.practicing` (advanced)
- `selectedModalities: Set<Modality>` — which practices interest them
- `intention: Intention` — what they're seeking (enum, see below)
- `birthDate: Date?` — optional, needed for astrology/numerology
- `birthTime: Date?` — optional, needed for full chart
- `birthPlace: String?` — optional city/country
- `notificationsEnabled: Bool` — whether they opted in
- `onboardingCompleted: Bool` — tracks if onboarding has been finished
- `hasSkippedBirthData: Bool` — whether they skipped birth details

**Enums to create:**

```
ExperienceLevel: String, CaseIterable
  - curious      → label: "Just curious"
  - exploring    → label: "I've explored a bit"
  - practicing   → label: "I practice regularly"

Modality: String, CaseIterable, Identifiable
  - thetaHealing   → label: "Theta Healing"    icon: "sparkles"
  - astrology      → label: "Astrology"         icon: "star"
  - numerology     → label: "Numerology"        icon: "number"
  - humanDesign    → label: "Human Design"      icon: "person.crop.circle"
  - meditation     → label: "Meditation"        icon: "moon.stars"
  - energyHealing  → label: "Energy Healing"    icon: "waveform.path.ecg"

Intention: String, CaseIterable
  - selfDiscovery    → label: "Self-discovery"
  - healingLetGo     → label: "Healing & letting go"
  - relationships    → label: "Better relationships"
  - careerPurpose    → label: "Career & purpose"
  - spiritualGrowth  → label: "Spiritual growth"
  - justExploring    → label: "Just exploring"
```

Also add a computed property `requiresBirthData: Bool` that returns `true` if `selectedModalities` contains `.astrology` or `.humanDesign`.

Persist this model to `UserDefaults` using `@AppStorage` or Codable + UserDefaults so it survives app restarts.

---

### PART 2 — ONBOARDING COORDINATOR

Create `OnboardingCoordinator.swift`. This manages which screen is shown and handles forward/back navigation between the 6 onboarding steps.

Use an enum `OnboardingStep` with cases:
1. `welcome`
2. `experienceLevel`
3. `modalityPicker`
4. `birthDetails` (only shown if `requiresBirthData` is true)
5. `intentionPicker`
6. `summary`

The coordinator must:
- Track the current step
- Have a `next()` method that automatically skips `birthDetails` if not needed
- Have a `back()` method
- Mark `userProfile.onboardingCompleted = true` when the user finishes from the summary screen

---

### PART 3 — ONBOARDING SCREENS

Create one SwiftUI View file per screen. All screens share these design rules:

**Visual Design:**
- Dark background: `Color(hex: "0D0B1E")` (deep cosmic navy)
- Accent gold: `Color(hex: "C9A84C")`
- Soft lavender: `Color(hex: "A78BCA")`
- Text primary: `.white`
- Text secondary: `Color.white.opacity(0.6)`
- Corner radius on cards: 16
- All screens use a `ZStack` with a subtle animated gradient background (two soft radial gradients in lavender and indigo, slowly pulsing with a repeating animation)
- Font: Use `Georgia` or `Didot` for headings (spiritual, elegant serif feel). Use `SF Pro Rounded` for body text.
- Each screen animates in with a `.opacity` + `.offset(y: 30)` transition on `.onAppear`

**Shared Components to create:**
- `OnboardingProgressBar` — a thin gold progress bar at the top showing current step out of 6
- `OnboardingPrimaryButton` — a full-width gold gradient button with rounded corners
- `OnboardingBackButton` — subtle back chevron top-left, only shown from step 2 onward

---

#### Screen 1 — WelcomeView.swift

Content:
- Animated sacred geometry icon in the center (use overlapping circles, `Circle()` strokes in SwiftUI, rotating slowly)
- Large heading: `"Welcome to\nHolistic Unity"`
- Subtitle: `"Your journey to self-discovery starts here."`
- Primary button: `"Begin My Journey"`

No back button on this screen. No progress bar on this screen.

On appear: fade in the icon first, then the text, then the button — staggered with `.animation(.easeOut.delay(n))`.

---

#### Screen 2 — ExperienceLevelView.swift

Content:
- Heading: `"Where are you on your journey?"`
- Subheading (adaptive by level — shown after selection, not before):
  - curious: `"Perfect — we'll guide you every step of the way."`
  - exploring: `"Great — we'll deepen what you already know."`
  - practicing: `"Welcome home — your space is ready."`
- Three large tappable cards, one per `ExperienceLevel` case
- Each card shows: an SF Symbol icon, the level label, and a one-line description:
  - curious: `"I've never tried holistic practices before"`
  - exploring: `"I know the basics and want to go deeper"`
  - practicing: `"I have regular sessions or I'm a practitioner"`
- Selected card gets a gold border and a soft glow effect (shadow in accent gold)
- Primary button: `"Continue"` — disabled until a selection is made

Bind the selection to `userProfile.experienceLevel`.

---

#### Screen 3 — ModalityPickerView.swift

Content:
- Heading: `"What speaks to you?"`
- Adaptive subheading based on `experienceLevel`:
  - curious: `"Choose what feels interesting — no experience needed."`
  - exploring: `"Select the practices you want to explore further."`
  - practicing: `"Which modalities are part of your practice?"`
- A 2-column `LazyVGrid` of modality cards. Each card shows:
  - A large SF Symbol icon
  - The modality label
  - A short description (adaptive):
    - **curious descriptions** (simple, inviting):
      - Theta Healing: "Shift limiting beliefs through guided meditation"
      - Astrology: "Understand yourself through the stars"
      - Numerology: "Discover your life path through numbers"
      - Human Design: "Your unique energetic blueprint"
      - Meditation: "Calm the mind, expand awareness"
      - Energy Healing: "Restore balance to your energy field"
    - **exploring/practicing descriptions** (concise, practitioner-friendly):
      - Theta Healing: "Subconscious reprogramming & belief work"
      - Astrology: "Natal charts, transits & synastry"
      - Numerology: "Life path, expression & soul urge numbers"
      - Human Design: "Type, authority, profile & gates"
      - Meditation: "Guided, breathwork & mindfulness"
      - Energy Healing: "Reiki, chakra work & biofield therapy"
  - Selected cards show a gold checkmark overlay and gold border
  - Multiple selections allowed
- Note below grid: `"You can always add more later"`
- Primary button: `"Continue"` — enabled even with zero selections (with label changing to `"Skip for now"` if nothing selected)

Bind selections to `userProfile.selectedModalities`.

---

#### Screen 4 — BirthDetailsView.swift (conditional)

Only shown if `userProfile.requiresBirthData` is true.

Content:
- Heading: `"Your Cosmic Blueprint"`
- Subheading: `"Your birth details let us generate your personal chart — it's like a fingerprint for your soul."`
- Three input fields:
  1. `DatePicker` for birth date — label: `"Date of birth"`
  2. `DatePicker` for birth time (hour + minute only) — label: `"Time of birth"` — with a `Toggle` below labeled `"I don't know my exact time"` that disables this field and sets `birthTime = nil`
  3. `TextField` for birth place — label: `"City & country of birth"` — placeholder: `"e.g. Rome, Italy"`
- A small note: `"This data is private and never shared without your consent."`
- Two buttons:
  - Primary: `"Build My Blueprint"`
  - Secondary text button: `"Skip for now"` — sets `hasSkippedBirthData = true` and advances

Bind all fields to `userProfile`.

---

#### Screen 5 — IntentionPickerView.swift

Content:
- Heading: `"What are you seeking?"`
- Subheading: `"This helps us show you what matters most."`
- A vertical list of tappable rows, one per `Intention` case
- Each row: a soft icon (SF Symbol) on the left, the intention label, a subtle chevron on the right
- Selected row gets highlighted with a soft gold left-border accent and background tint
- Single selection only
- Primary button: `"Continue"` — disabled until selection made

Bind to `userProfile.intention`.

---

#### Screen 6 — OnboardingSummaryView.swift

Content:
- Heading: `"Welcome, [userProfile.name]."`
  - If name is empty, use `"Welcome."` instead
- Subheading: `"Your space has been prepared."`
- A glowing summary card that shows:
  - Their selected modalities as pill badges (gold outlined, small icons)
  - Their intention label with a soft icon
  - If birth data was provided: a small note `"✦ Your personal chart is being prepared"`
- Notification opt-in section:
  - Label: `"Get your daily cosmic insight?"`
  - A custom toggle styled in gold
  - Sublabel: `"We'll send you one gentle nudge per day — no spam."`
- Primary button: `"Enter Holistic Unity"` — calls `coordinator.finish()` which sets `onboardingCompleted = true` and dismisses onboarding

---

### PART 4 — PERSONALIZATION ENGINE

Create `PersonalizationEngine.swift` as a struct with static methods. This is the bridge between the `UserProfile` and everything the app shows.

```swift
struct PersonalizationEngine {
    static func homeGreeting(for profile: UserProfile) -> String
    static func featuredModalities(for profile: UserProfile) -> [Modality]
    static func homeSectionTitle(for profile: UserProfile) -> String
    static func practitionerSortHint(for profile: UserProfile) -> String
    static func dailyInsightTitle(for profile: UserProfile) -> String
    static func shouldShowBirthDataPrompt(for profile: UserProfile) -> Bool
}
```

Implement these as follows:

**homeGreeting** — returns a time-aware greeting string:
- Morning (5am–11am): "Good morning"
- Afternoon (12pm–5pm): "Good afternoon"
- Evening (5pm–10pm): "Good evening"
- Night (10pm–4am): "Welcome back"
- Append name if available: "Good morning, Sofia."

**featuredModalities** — returns the user's `selectedModalities` as an array, sorted by relevance. If empty, return all modalities.

**homeSectionTitle** — based on experienceLevel:
- curious: `"Start Your Journey"`
- exploring: `"Continue Exploring"`
- practicing: `"Your Practice"`

**practitionerSortHint** — a string hint for your backend/API when fetching practitioners:
- Returns the first selected modality's raw value, or `"all"` if none selected

**dailyInsightTitle** — based on intention:
- selfDiscovery: `"Your daily reflection"`
- healingLetGo: `"Today's healing focus"`
- relationships: `"Today's connection insight"`
- careerPurpose: `"Your purpose for today"`
- spiritualGrowth: `"Today's spiritual focus"`
- justExploring: `"Today's discovery"`

**shouldShowBirthDataPrompt** — returns `true` if `requiresBirthData` is true AND `hasSkippedBirthData` is true (i.e., they need birth data but skipped it — prompt them inside the app later)

---

### PART 5 — HOME SCREEN INTEGRATION (EXAMPLE)

Create `HomeView.swift` as a demonstration of how the onboarding data drives the main app screen.

The view should:
1. Receive `@EnvironmentObject var userProfile: UserProfile`
2. Use `PersonalizationEngine` for all dynamic text
3. Show at the top: the personalized greeting from `PersonalizationEngine.homeGreeting`
4. Show a section header using `PersonalizationEngine.homeSectionTitle`
5. Show horizontal scrolling cards for each modality in `PersonalizationEngine.featuredModalities`
6. Show a `dailyInsightTitle` card in the middle
7. If `PersonalizationEngine.shouldShowBirthDataPrompt` is true, show a soft banner: `"Complete your cosmic blueprint to unlock your personal chart →"`
8. Use the same dark cosmic color scheme as the onboarding

---

### PART 6 — APP ENTRY POINT

Update `HolisticUnityApp.swift` (or your `@main` App struct) to:

1. Create a single `@StateObject var userProfile = UserProfile()` at the top level
2. Inject it as `.environmentObject(userProfile)` into the view hierarchy
3. Show `OnboardingContainerView` if `!userProfile.onboardingCompleted`, otherwise show `HomeView`
4. `OnboardingContainerView` wraps all 6 screens, uses `OnboardingCoordinator` to move between them, and passes `userProfile` through

---

### TECHNICAL REQUIREMENTS

- **iOS target:** iOS 16+
- **Framework:** SwiftUI only (no UIKit)
- **State management:** `@StateObject`, `@ObservedObject`, `@EnvironmentObject` — no third-party libraries
- **Persistence:** `UserDefaults` via `Codable` conformance on `UserProfile`
- **No external dependencies** — use only SF Symbols for icons, system fonts + Georgia/Didot for typography
- **Accessibility:** All interactive elements must have `.accessibilityLabel` set
- **Color extension:** Include a `Color(hex:)` extension for the hex color values used throughout

---

### FILE STRUCTURE SUMMARY

```
HolisticUnity/
├── App/
│   └── HolisticUnityApp.swift          ← Entry point, injects environment
├── Models/
│   ├── UserProfile.swift               ← ObservableObject, all user data
│   └── Enums.swift                     ← ExperienceLevel, Modality, Intention
├── Onboarding/
│   ├── OnboardingCoordinator.swift     ← Step manager
│   ├── OnboardingContainerView.swift   ← Wraps all steps
│   ├── WelcomeView.swift
│   ├── ExperienceLevelView.swift
│   ├── ModalityPickerView.swift
│   ├── BirthDetailsView.swift
│   ├── IntentionPickerView.swift
│   └── OnboardingSummaryView.swift
├── Home/
│   └── HomeView.swift                  ← Personalized home screen demo
├── Personalization/
│   └── PersonalizationEngine.swift     ← Static personalization logic
└── Shared/
    ├── OnboardingProgressBar.swift
    ├── OnboardingPrimaryButton.swift
    ├── OnboardingBackButton.swift
    └── ColorExtension.swift            ← Color(hex:) helper
```

---

Generate all files completely, with no placeholder comments like `// TODO` or `// implement this`. Every function must be fully implemented. Add brief inline comments explaining the non-obvious logic, especially in `OnboardingCoordinator` and `PersonalizationEngine`. Make the code clean, idiomatic SwiftUI that a mid-level iOS developer could read and extend easily.
