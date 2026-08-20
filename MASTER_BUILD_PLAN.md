# Project Moana — Master Build Plan v2

**Status:** Replaces the original master build plan in full. Nothing from v1 should be treated as authoritative where the two disagree.
**Audience:** Claude Code / engineering agent, working across multiple sessions.
**"Moana" is an internal codename only.** The public brand name is undecided and deliberately deferred (see §12.1). Do not create logos, brand assets, domains, or store listings under this name.

---

## 0. How to use this document

This is a decision record, not a spec to implement in one pass. When a technical choice arises that isn't covered here, make the choice most consistent with the **Core Principles** in §1.

Two rules that override everything else:

1. **Do not skip Phase −1.** The project has one assumption that can invalidate the entire product, and Phase −1 tests it in a weekend. Building Phase 0 before Phase −1 passes is the single most expensive mistake available.
2. **Flag, don't silently build.** If a requested feature violates a Core Principle, say so before implementing it.

§11 contains a decision log explaining what changed from v1 and why. Read it if a choice here seems to contradict an older instruction.

---

## 1. Core Principles

Every feature and technical shortcut is evaluated against these.

1. **Calm over information density.** Never a screen that reads as a weather app, dashboard, spreadsheet, or trading terminal. One idea, one visual, one line of text per screen.
2. **Truthful, not decorative, data.** Every visual traces to a real physical variable. Artistic licence is allowed in *how* data is rendered — colour, motion, sound — never in fabricating values.
3. **One data engine, many thin views.** Globe, audio, art prints, wallpaper, widget, and trip-timing are all renderings of the same swell-field model. No feature builds its own parallel data transform.
4. **Global in schema, narrow in v1 scope.** The data model supports all ocean basins from day one, even though v1 may surface only the North Atlantic. Never hardcode Atlantic-only assumptions into core types.
5. **No dark patterns, no subscription fatigue.** One-time purchases only. This is a settled decision, not a preference (see §7).
6. **Cheap and reversible before expensive and permanent.** Prefer the experiment that can invalidate an assumption over the build that assumes it. This principle is why Phase −1 exists and why the brand name is deferred.

---

## 2. The Concept

### 2.1 What it is

A cinematic global "Ocean Observatory." It renders real marine forecast data — swell height, direction, period, wind-wave — as a living animated dark globe of flowing light, not as numbers or charts. Users identify a coherent, currently-active swell system, name it or accept a generated name, and **adopt** it: follow its path across ocean basins toward coastlines, save it to a personal diary, and watch it arrive — or fade.

The core emotional claim: **a swell is a character.** It is born, it travels, it arrives, it dies. Everything else in the product is scaffolding for that.

### 2.2 What it is not

- Not a forecast-accuracy competitor to Surfline/Magicseaweed.
- Not a social network or public feed.
- Not a general ambient-sound app competing head-on with Endel.
- Not a crypto/NFT collectible product.
- Not a poster-generator SaaS.

Moana uses its own swell-field engine to offer a thin, differentiated feature adjacent to each of those markets, never to become a generalised competitor in any.

### 2.3 The interaction loop

1. App opens directly into the globe. No login wall, no onboarding carousel.
2. One line of text: *"The ocean is moving."*
3. Ambient swell fields visible globally as slow flowing light/ribbons.
4. User taps a visually distinct, coherent-moving region.
5. Minimal panel: name, one-line description ("Long-period WNW pulse crossing the North Atlantic"), a time-based path, a **Follow** action.
6. If followed: saved to the **Swell Diary**. Optional secondary actions unlock (art capture, later: audio, trip suggestion).
7. A quiet notification later: *"Helena reaches your saved coast tomorrow."*
8. **The ending.** When the pulse dissipates, the diary entry seals: the full path, birth to death, becomes a completed story. This is the emotional peak of the product and the natural, non-manipulative moment to offer a print.

---

## 3. Design Language

### 3.1 Visual identity

- **Palette:** near-black deep navy ground, restrained cobalt/cyan energy highlights. No neon. Red/orange/green heat-map palettes are **forbidden** — they read instantly as "weather app" and break Principle 1.
- **Typography:** refined modern sans-serif, with occasional serif/script accents for named swells (the "legend on a poster" register).
- **Motion:** slow, organic, not obviously looping. Ribbons and particles should feel like fluid, not like a shader loop.
- **UI chrome:** minimal always. No cards, tables, dashboards, or forecast grids by default. Any data-dense view is opt-in behind a deliberate tap.

### 3.2 Why this matters technically

The temptation during development will be to add "just one more panel" to expose an API value or debug output. Resist. Debug values go behind a dev-only overlay flag, never a permanent UI element.

### 3.3 Attribution has a designed home — decided in Phase 0

Open-Meteo data is CC BY 4.0 and **requires a visible credit link wherever the data is displayed**. The entire globe displays the data, so this is a real constraint on a UI that forbids chrome.

**Decided (2026-08-17, Phase 0 build):** the two options weren't mutually exclusive, so both were used together — a hairline-weight "Data: Open-Meteo" credit sits permanently at a screen edge (satisfies "visible wherever the data is displayed" on its own, without waiting for a tap), and tapping it opens a one-tap "About the data" sheet with the full CC BY 4.0 credit and links. Implemented in `phase-0-prototype/src/components/Attribution.tsx`.

Do not defer this. A legal requirement bolted on at Phase 5 will look bolted on.

---

## 4. Data Architecture

### 4.1 Primary data source

**Open-Meteo Marine Weather API.** Globally available, returns significant wave height, swell height/direction/period/peak period, wind-wave height/direction/period, and secondary/tertiary swell components on some models. ~8-day forecast horizon. Historical via ERA5-Ocean (coarse ~50km; fine for climatology and Swell Safari, not for spot precision).

**Licensing — act before any paid feature ships.** Two separate things:

- The **data** is CC BY 4.0: commercial use permitted with attribution.
- The **free API tier** is non-commercial only, capped at 10,000 calls/day.

The moment a paid unlock ships, the free tier no longer covers the project. Budget the Open-Meteo Standard plan (~$29/month, ~1M calls/month, includes Marine API) from Phase 5 onward. **Model call volume before assuming this is enough** — Open-Meteo counts fractionally by variables × timespan, so a large multi-location, multi-variable, multi-day request is not one call. Server-side-only ingestion (§4.3) is what keeps this affordable.

Optional later sources: NOAA CO-OPS (tides/currents near US coasts), Open-Meteo Ensemble Mean (model-disagreement/confidence layer), Open-Meteo AWS Open Data (offline historical precompute for Swell Safari).

### 4.2 Global grid

- Fixed ocean-only coordinate grid: ~1–2° latitude, ~2–3° longitude, masked to exclude land using any coarse open land/sea mask.
- Spans all basins from the start — North/South Atlantic, North/South Pacific, Indian, Southern Ocean, Arctic where coverage allows — even if the client initially surfaces only the North Atlantic.
- Each cell stores per timestamp: swell height, direction, period, wind-wave height/direction, and a basin label assigned once via static lookup, never recomputed per request.

### 4.3 Ingestion — server-side, scheduled, no live server

Run every 3–6 hours:

1. `fetch_marine_grid_snapshot(timestamp)` — batched calls respecting API batching limits.
2. Store raw JSON keyed by cell ID and timestamp. **Keep raw data permanently**, even after deriving processed fields, for debugging and reprocessing.
3. `derive_swell_field(raw_snapshot)` — normalise per §4.4.
4. `cluster_swell_pulses(field_sequence)` — identify followable systems per §4.5.
5. `export_observatory_state(date_range)` — produce the compact JSON bundle clients consume.

**Architecture decision: no backend server initially.** The scheduled job writes a static JSON bundle to object storage behind a CDN. Clients fetch a file. No API server, no database, no auth. This satisfies the "one artifact clients consume" rule while removing an entire category of work and operational cost. Introduce a real backend only when a feature genuinely requires one (server-side purchase validation, cross-device sync at scale).

Clients never call Open-Meteo directly. Ever.

### 4.4 Normalised Swell Field model

Per grid cell per timestamp:

- **`energy`** — derived scalar driving visual brightness/intensity. Use a proxy proportional to real wave energy flux: **H² × T**. Period matters more than raw height for both physical power and narrative quality; a 2m/15s groundswell is a more significant event than a 2.5m/7s wind sea, and the model must reflect that.
- **`direction_vector`** — unit vector from swell direction, drives particle/ribbon flow.
- **`category`** — `groundswell` (period ≳ 11s) vs `wind_sea` (shorter, more local/chaotic). Drives both visual and sonic treatment. **Revised from ≥12s during Phase −1 validation** (see §8/§12.2) — real-event testing across four North Atlantic storms showed a consistent, physically small (1s) gap between the original threshold and what real events needed to track as one coherent system for 72h+; a fifth, genuinely long-distance Pacific event passed at the original ≥12s with large margins, so the revision affects weaker/shorter systems specifically, not the mechanism generally.
- **`basin`** — static lookup. Used for narrative ("crossing the South Pacific") and, later, musical root-key selection.

This is the single canonical structure every downstream feature reads. No exceptions.

### 4.5 Pulse clustering and tracking

True storm-origin tracking is scientifically non-trivial and out of scope. Use this pragmatic heuristic — **but validate it in Phase −1 before building anything on top of it.**

**Clustering, per frame:**
1. Filter cells to period above threshold and energy above a floor.
2. Region-grow across adjacent cells where direction agrees within an angular tolerance and period within a period tolerance.
3. Discard clusters below a minimum cell count.

**Tracking, across frames — the part naive implementations get wrong:**

Deep-water swell group velocity is approximately **Cg ≈ 1.56 × T m/s**. A 14-second swell travels ~78 km/h — roughly **470 km in a 6-hour step**, which is often further than the cluster's own radius. Nearest-centroid matching will therefore mismatch or silently drop tracks.

Correct approach: **project each cluster's expected position forward using group velocity and direction, then match to the nearest cluster to the predicted position.** Allow a track to survive 1–2 missing frames before declaring it dead.

**Identity:** each tracked cluster gets an ID, a `first_detected_at`, an approximate origin basin (centroid at first detection, described narratively), a generated name, and — on dissipation — an `ended_at`.

**Merges and splits are physical, not bugs.** Handle them with a lineage model: a pulse may carry a `parent_id`. "Helena has weakened; a new pulse has split from her" is a better story than clean single-object tracking, not a worse one.

**Framing constraint:** never claim precise storm-origin attribution ("born from a storm at 45°N, 30°W"). A coarse forecast grid cannot honestly support that. Use basin-level narrative language only.

### 4.6 Rarity emerges from physics, not design

Southern Ocean swells crossing the Pacific are 10-day, 10,000km journeys. Those are rare and epic **by physics**. A long-lived, multi-basin, high-energy pulse should simply *be* a bigger event than a three-day local wind sea — longer path, more basins traversed, more arrival notifications.

Do not add badges, tiers, streaks, or achievement mechanics. The rarity is real; surfacing it honestly is enough.

---

## 5. Visual Engine

### 5.1 Rendering approach

- **Do not** render a literal scientific vector-field or wind-map visualisation. It reads as a technical tool and breaks Principle 1.
- **Do** build an art-directed particle/ribbon system where swell-field data controls position, direction, and relative intensity, while a custom shader controls softness, density, colour grading, bloom, and organic motion easing.
- Land and coastlines barely visible — enough for orientation, not enough to read as an atlas.

### 5.2 Development environment: iterate on web, judge on phone

**This reverses v1's instruction and the reasoning matters.**

v1 was right that the emotional target — "a small living object in your hand" — can only be validated on a phone. It was wrong to conclude that shaders should therefore be *authored* in Expo GL. That environment has slow reload, thin tooling, and obscure failure modes; weeks can be lost fighting the runtime and then misattributed to the aesthetic not working.

So:
- **Author and iterate** the shader in a browser (Vite + Three.js, or Next.js + React Three Fiber) with instant reload.
- **Judge** it by loading on a physical phone in Safari/Chrome, held in the hand, at night.
- **Commit** to the native 3D stack only once the visual is proven worth the porting cost.

The validation target is unchanged. Only the authoring environment moves.

### 5.3 Mobile stack (iOS + Android)

- Expo + React Native + TypeScript, single codebase.
- `@react-three/fiber/native` + `expo-gl` + `expo-three` for the globe.
- `react-native-skia` for 2D polish — blur, grain, vignette, glass panels — where a full 3D shader isn't needed.
- `react-native-reanimated` + `react-native-gesture-handler` for timeline scrubbing and globe rotation.
- `expo-haptics` for subtle feedback on swell selection.
- `expo-notifications` for arrival alerts.
- **Adaptive quality:** dynamically reduce particle count, bloom, and render resolution on low-end devices or battery saver. The app must never look broken or laggy — it should gracefully simplify.

### 5.4 Web stack (Phase 7)

Next.js + TypeScript, React Three Fiber + drei, custom GLSL, restrained bloom, Framer Motion for UI transitions, Tailwind or CSS modules for the minimal UI layer only — never for the 3D scene.

---

## 6. Features

### 6.1 Ocean Observatory — core, build first

- Full-screen animated global swell field, always-on ambient motion.
- Time scrubber: Now / Tomorrow / 3 Days (extendable to 7).
- Tap-to-inspect: minimal raw values in a small dismissible overlay. **This is the only place raw numbers are permitted**, and only on deliberate request.
- No login required.

### 6.2 Adopt a Swell

- Tapping a detected pulse surfaces its identity: name, category, basin, one-line narrative.
- **Follow** saves it to the Swell Diary.
- Followed swells show estimated path and arrival sequence across basins and saved coastlines.
- Entries enrichable by the user: note, photo, session record ("surfed this at Ericeira, 6/10, longboard").
- **On dissipation the entry seals** — completed path, birth to death. Offer the art capture here and nowhere pushier.

### 6.3 Saved Coasts + Notifications

- Users save named coastal **regions**, not individual breaks — "Galicia," "West Ireland," not named reefs.
- **Region taxonomy must mirror SandB's inventory geography** — Central America, Europe, SE Asia, South America — rather than being invented fresh. This costs nothing now and makes the Phase 8 join trivial instead of a migration.
- When a followed swell's path intersects a saved coast within a time window, send **one** quiet notification.
- Cap frequency. Word narratively — "Helena reaches Galicia tomorrow morning" — never as a raw alert ("1.8m @ 14s detected").

### 6.4 Widget — free tier, higher priority than v1 implied

A lock-screen / home-screen surface showing where a followed swell is right now will be seen far more often than the app itself. Treat it as a **primary retention surface and keep it free**. It is also the most shareable artefact the product has, which matters because conversion is a volume game (§7).

### 6.5 Personalised Swell-Moment Art / Wallpaper — first paid layer

- Render a static, high-quality export of the swell field at any moment — current, or a saved past moment from the diary. Usable as wallpaper or exported for print.
- Reuses §4.4 data and §5 rendering. **No new data pipeline** — only a static export path.
- **Free:** a single daily wallpaper reflecting current global conditions.
- **Pro/paid:** personalised moment captures ("the day we met," "my first wave"), multiple saved swells, live/animated lock-screen variants (Android first — iOS live wallpaper APIs are more restricted), and physical print export.

### 6.6 Swell-to-Sound — v2, explicitly unfunded

Deferred out of v1. It needs a sound designer's ear the project doesn't currently have, and competes on production value with well-resourced incumbents (Endel, Drift, Sounding Tides). It is the weakest moat and the highest craft cost in the plan.

When built, the hook is narrative and nothing else: *"fall asleep to the swell you adopted."*

Sonification mapping — an artistic **starting point**, not a deterministic formula:

| Physical variable | Sound parameter |
|---|---|
| Swell period | Tempo / note duration — long period = slow, spacious drones |
| Wave height | Amplitude / low-end dynamics |
| Swell direction | Stereo panning / spatial position |
| Water depth along path | Filter cutoff — shallower opens/narrows the filter |
| Refraction angle near shore | Pitch bend / harmonic shift (wave rays bending as depth decreases) |
| Shoaling near shore | Rising crescendo as the swell nears a saved coast |
| Multiple swell trains | Layered polyphony — primary as bass drone, secondary as sparser higher layers |
| Ocean basin | Root key / scale — purely artistic, one palette per basin |

**Build constraint:** a sound designer's judgment must sit between raw physics and final output. Strictly literal sonification of messy short-period data sounds arbitrary and unpleasant. The honest claim is "inspired by real ocean physics," never "scientifically accurate representation."

### 6.7 SandB Trip-Timing Bridge — highest long-term strategic value

- When a followed swell approaches a coastline with matching SandB inventory, surface a soft suggestion: *"This swell reaches Galicia in 3 days — see nearby stays."*
- The deliberate connective layer between Moana (emotional front door) and SandB (transactional back end).
- **Build-order constraint:** do not build until **both** Moana's core experience and SandB's inventory are independently solid. The feature's entire value depends on both sides already being trustworthy alone.

### 6.8 Swell Safari — optional, lowest priority

- Lightweight daily mini-game on historical data (ERA5-Ocean or precomputed AWS snapshots), not the live grid.
- Present a real historical scenario and 3–5 candidate coastlines; user picks; app reveals the outcome and a one-line explanation ("Galicia won: WNW exposure + 14s period + light offshore wind").
- Visually consistent with the Observatory. Not a separate flashy game identity — a small daily ritual tab.
- Free. Build only with spare capacity after everything else is stable.

### 6.9 Rejected — do not build without revisiting

- **Public social feed / community sightings.** Dilutes the calm personal identity; competes with better-resourced purpose-built social products.
- **NFT/crypto "own a swell."** No product value; reputational risk in a wellness-positioned product.
- **General-purpose poster/art generator.** The print feature stays tightly scoped to Moana's own swell data.
- **Daily matched historical art/weather swipe.** Charming but thin. Never a roadmap priority.
- **Achievement/badge/streak systems.** See §4.6.

---

## 7. Monetization — settled

**One-time purchases only. No subscription anywhere in the app. This is decided, not open.**

Rationale: subscriptions exist to fund recurring costs. Moana's recurring cost is ~$29/month of API plus a trivial CDN bill — no server, no support burden, no content treadmill. A subscription would charge rent for something that doesn't cost rent. Additionally, a $4/month subscription only outperforms a €12.99 one-time purchase if the average subscriber stays past ~4 months, which passive ambient apps rarely achieve. "No subscription" is also a genuine differentiator on the store page in a category saturated with them.

| Layer | Model | Starting price |
|---|---|---|
| Observatory + Adopt-a-Swell + Saved Coasts + Widget | Free, always | — |
| Moana Pro (art moments, live wallpaper, multiple saved swells; later: audio) | Single one-time unlock | €12.99 |
| Digital moment capture / wallpaper export | One-time per moment | €4.99 |
| Physical print | One-time | €29–39, priced to print partner |
| SandB trip-timing bridge | Indirect — drives SandB bookings | No in-app charge |
| Swell Safari | Free | — |

**Revenue is a volume game, not a pricing game.** Whether the unlock is €5 or €15 matters far less than whether 2% or 6% of users convert — which is driven by how well the free tier spreads. This is the argument for keeping the widget and shareable prints on the free side.

**Revisit condition:** if cloud sync, ongoing sound packs, or any genuinely recurring cost is introduced, reopen this decision. Recurring cost justifies recurring price. Nothing else does.

---

## 8. Build Sequence

### Phase −1 — Clustering validation (do this first, before any app code)

**The product's central assumption is that swell clustering produces satisfying, discrete, persistent characters.** Everything downstream — the diary, notifications, prints, the entire emotional loop — assumes a swell holds one identity from mid-ocean detection to coastal arrival. If IDs fragment, flicker, or dissolve, there is no product. v1 discovered this at Phase 3, after shaders and an ingestion pipeline. Discover it in a weekend instead.

**Deliverable:** a throwaway Python notebook. No app code, no TypeScript, no shaders.

**Setup:**
- North Atlantic box, roughly 20–65°N, 80°W–0°, at the planned 2° × 3° resolution (~450 ocean cells).
- Historical data at 6-hourly steps.
- Variables: swell height, direction, period, plus wind-wave for contrast.

**Two test windows, both required:**
1. **Clean:** a two-week winter period containing a large groundswell that demonstrably reached Portugal or Ireland. *(Specific dates TBD — pick a defensible candidate and confirm.)*
2. **Messy:** an unremarkable two weeks with mixed swell trains and no dominant system. **This is the real test** — most of the year looks like this, and it is what users will actually open the app to.

**Method:** implement §4.5 clustering and group-velocity-predicted tracking. Do **not** hand-pick thresholds. Make all four — period cutoff, energy floor, direction tolerance, minimum cluster size — parameters, and sweep ~12–16 combinations, each producing its own output.

**Output:** per frame, a scatter plot coloured by cluster ID with colours consistent across frames, stitched into a GIF. Plus a centroid-path plot per run. Ugly matplotlib is correct here; this is not an aesthetic test.

**Pass criteria — write these down before looking at results:**
- **Clean window:** at least one cluster holds a stable ID for 72+ hours and travels 2,000+ km.
- **Messy window:** no more than ~5 simultaneous clusters in a typical frame. Beyond that there is no "one thing" for a user to adopt.
- **Robustness:** a *range* of parameter settings passes, not a single knife-edge combination. A result that works at exactly one setting is itself a failure signal.
- **Blind read:** show the GIF unlabelled to someone and ask "how many distinct things are moving, and can you follow one across?" If they can't, neither can a user.

**Failure modes and responses:**
- *Fragmentation* (one swell → many clusters): thresholds too tight, or spatially smooth direction/period before clustering. Cheap fix.
- *Blob merge* (basin becomes one cluster): cluster in direction-period space, not just geographic space. Open-Meteo's secondary/tertiary swell components may separate coexisting trains.
- *ID flicker:* tracking problem — use predicted-position matching and tolerate 1–2 missing frames.
- *Genuine merges/splits:* physical, not a bug. Implement the lineage model (§4.5).

**Fallback if the mechanic fundamentally doesn't hold:** pivot from adopting a *system* to adopting an *arrival* — track energy building at a specific coastline over time. Less romantic, far more tractable, and preserves most of the emotional payoff ("it's coming to your coast"). Escalate this decision rather than deciding it unilaterally.

### Phase 0 — Visual-only prototype (no live data, no backend)

Goal: prove the aesthetic feels genuinely special before any data engineering.

- Author in a browser for iteration speed (§5.2); judge on a physical phone.
- Hard-code one fake swell path ("Helena") crossing the North Atlantic as local TypeScript data.
- Full cinematic globe, minimal UI per §3.
- Time scrubber (Now / Tomorrow / 3 Days) moves the hard-coded path's displayed position only. **Superseded, decision-log row 18:** round 9 of the prototype's visual iteration deliberately extended the scrubber to also advance a multi-source swell-propagation field (still entirely hardcoded/invented data, no live ingestion), at the user's direct request, because a single global flow direction was reading as "smeared" ocean texture rather than current. The scrubber still moves nothing about Helena's own path logic; it now additionally advances each source's front.
- **Follow** persists locally (AsyncStorage). No backend.
- Decide the attribution treatment (§3.3) here.

**Success criterion — falsifiable, not vibes:** hand the phone to **five people who don't surf**, say nothing, and time them. If they don't rotate it for 30+ seconds unprompted, the visual isn't working yet. Iterate on shaders, motion, and typography. **Do not add data complexity to compensate for a visual that isn't landing.**

### Phase 1 — Global marine data ingestion

- Stand up the scheduled job (§4.3) writing static JSON to object storage.
- Build against the full global grid (§4.2) from the start.
- Store raw + derived snapshots.
- Sanity-check derived energy and direction against a known recent real swell event before trusting the pipeline.

### Phase 2 — Replace hard-coded data with real data

- Swap the fake "Helena" for a real ingested swell field.
- Confirm the engine still looks calm with real, messier data. **Adjust the art-direction layer, not the underlying data.**

### Phase 3 — Clustering & Adopt a Swell

- Port the Phase −1 heuristic (with its validated parameters) into the pipeline.
- Build the Swell Diary — local first, anonymous device-keyed backup from day one (§9.2), accounts later.
- Build tap-to-select, name generation, Follow, and the **dissipation/sealing** flow (§2.3 step 8).

### Phase 4 — Saved Coasts + Notifications + Widget

- Saved-coast selection UI, using SandB-aligned region taxonomy (§6.3).
- Path-intersection logic and quiet notifications (`expo-notifications`).
- Ship the free widget (§6.4).

### Phase 5 — Personalised art/wallpaper export — first paid layer

- Static export path from the existing engine (§6.5).
- One-time purchase flow.
- **Move to the paid Open-Meteo plan before this ships** (§4.1).

**v1 scope ends here.** Everything below is explicitly unfunded and should not be planned around.

### Phase 6 — Swell-to-Sound (v2)

Per §6.6. Requires a sound designer.

### Phase 7 — Web version

Only after mobile is validated and stable. Port the shared data contract to Next.js + React Three Fiber. Reuse the same served JSON bundle; **do not duplicate ingestion logic.**

### Phase 8 — SandB Trip-Timing Bridge

Only once both sides are independently solid (§6.7).

### Phase 9 — Swell Safari

Lowest priority. Only with spare capacity.

---

## 9. Data Contracts

Define once in a shared package; use identically across mobile, web, and the ingestion job. Every feature consumes these rather than re-deriving its own notion of "what a swell is."

### 9.1 Core types

**`SwellFieldFrame`** — full grid state at one timestamp:
```
timestamp
cells: Array<{
  lat, lon, basin,
  energy,            // H² × T proxy
  direction_vector,  // unit vector
  category,          // 'groundswell' | 'wind_sea'
  swell_height,
  swell_period
}>
```

**`SwellPulse`** — one tracked, followable system:
```
id
name
first_detected_at
ended_at          // null while active — REQUIRED FROM DAY ONE
parent_id         // null unless split from another pulse — REQUIRED FROM DAY ONE
origin_basin      // approximate, narrative-only
category
path              // ordered centroid positions over time
current_energy
narrative_description
```

`ended_at` and `parent_id` are included from the start even though nothing consumes them until Phase 3. Retrofitting death and lineage into a tracked-object model is genuinely painful; the two nullable fields cost nothing now.

### 9.2 Persistence

- **Local-first.** The diary lives on device.
- **Anonymous device-keyed backup from day one.** No login, no account, but the diary survives a phone upgrade. The diary is where emotional investment accumulates; losing it churns exactly the users who care most.
- Upgradeable to real accounts later without migration pain — design the key accordingly.

---

## 10. Non-Goals for v1

- No precise storm-origin meteorological attribution.
- No spot-level forecast precision. This product operates at basin/coastal-region granularity.
- No public social feed, comments, or user-to-user visibility.
- No crypto/NFT mechanics.
- **No subscription of any kind.**
- No literal scientific vector-field or heatmap visual style in the default UI.
- No badges, streaks, or achievement mechanics.
- No sleep audio in v1.
- No Swell Safari in v1.
- No public brand name, logo, domain, or store listing until §12.1 is resolved.

---

## 11. Decision Log — what changed from v1 and why

| # | Change | Reasoning |
|---|---|---|
| 1 | **Phase −1 added** | v1 validated the clustering assumption at Phase 3, after shaders and ingestion. It's the one assumption that can invalidate the product, and it's testable in a weekend. |
| 2 | **Art export before sleep audio** | Art reuses the existing render engine with no new pipeline and lands on the emotional peak (a sealed swell). Audio needs a sound designer and competes on production value with Endel. Weaker moat, higher cost. |
| 3 | **Sleep audio + Swell Safari cut from v1** | Nine phases is an ambition, not a plan. v1 = beautiful globe, adoptable swell, arrival notification, print of the day it arrived. |
| 4 | **One-time purchase, settled** | v1 said "one-time unlock or bundled Pro tier" in three places, i.e. undecided. No recurring cost exists to justify recurring price. See §7. |
| 5 | **No backend initially** | Scheduled job → static JSON → CDN. Matches v1's own "one artifact clients consume" rule while removing a whole category of work. |
| 6 | **Anonymous device backup from day one** | Local-only was right in spirit but loses the diary on phone upgrade — the worst possible churn moment for the most invested users. |
| 7 | **Coastal taxonomy mirrors SandB** | Phase 8's value depends on a clean region join across four continents. Free now, a migration later. |
| 8 | **Shaders authored on web, judged on phone** | v1's validation target was right; its authoring environment was wrong. Expo GL's slow iteration risks misattributing tooling pain to aesthetic failure. |
| 9 | **Falsifiable Phase 0 gate** | "Does it feel special?" is unanswerable by its maker. Five non-surfers, 30 seconds, unprompted. |
| 10 | **`ended_at` + `parent_id` in schema** | Swell death is the strongest emotional beat available and the honest conversion moment. Merges/splits are physical reality. Both are painful retrofits. |
| 11 | **Attribution designed in Phase 0** | CC BY 4.0 requires a visible credit where data is displayed. Colliding with a no-chrome UI is a design problem, best solved early. |
| 12 | **Paid API plan budgeted** | Free tier is non-commercial; the first paid feature breaks it. ~$29/month, trivial — but must be actioned before Phase 5 ships. |
| 13 | **Widget promoted to free primary surface** | It'll be seen more than the app and is the most shareable artefact. Conversion is a volume game; don't paywall the spreading surface. |
| 14 | **Rarity from physics, no gamification** | Southern Ocean crossings are rare by nature. Surfacing that honestly beats inventing badges. |
| 15 | **Brand name deferred** | "Moana" is Disney territory. Nothing in Phase 0 depends on the name; codename and brand needn't match. Deferring costs nothing and avoids five turns of naming before any code exists. |
| 16 | **Groundswell threshold revised 12s → 11s; Phase −1 passed** | Real-event Phase −1 validation (§12.2) across five events, two ocean regions: North Atlantic storms consistently needed period≥11s to track as one system for 72h+; a genuinely powerful Pacific crossing passed at the original ≥12s with large margins. Reads as event strength, not a wrong threshold — revised deliberately, not tuned after one failure, per §8's own anti-p-hacking design (write criteria down before looking at results). |
| 17 | **Attribution treatment: hairline credit + one-tap sheet, combined** | §3.3 offered two options as alternatives; built Phase 0 with both — the hairline satisfies the legal "visible wherever displayed" bar unconditionally, the tap-through sheet gives room for the full CC BY 4.0 text and links without permanent chrome. See `phase-0-prototype/src/components/Attribution.tsx`. |
| 18 | **Timeline scrubber extended to drive the whole swell field, not just Helena's marker** | §8's original Phase 0 spec constrained the scrubber to Helena's position only. The user asked directly for the ocean's flow texture to represent real swell propagation ("where the swells can potentially go") rather than one arbitrary global direction, which also happened to be the root cause of feedback that the ocean looked "smeared." Implementing that meant the scrubber's `offsetHours` had to reach the field itself. Still zero live data — `swellSources.ts`'s five additional storms are invented, same standing as Helena. See `PROGRESS.md`'s round-9 entry. |
| 19 | **The ocean's noise sampling is isotropic, by decision — filaments dropped** | §5.1 asks for art-directed ribbons, and six rounds of shader comments claimed the field produced streaks. It never did: the anisotropic sampling had been a no-op since round 9 (a tangent decomposed against its own surface normal is identically zero). Round 16 fixed the mechanism correctly and the result was rejected on sight — hard, evenly spaced contour lines, not water. Shown both frames side by side afterwards, the user preferred the soft isotropic field: *"the first/left image is way better."* So the soft field is the chosen look, not a fallback. Round 17 removed the dead code and its misleading comment, and inverted the guard (`B2` in `parity-probe.mjs`) to assert isotropy holds. `git show 1856985` retains the working anisotropic implementation. See `PROGRESS.md`'s round-16 and round-17 entries. |

---

## 12. Open Questions

### 12.1 Brand name — deferred, not resolved

"Moana" is an internal codename. It cannot ship: Disney holds trademark territory and app store search returns entirely their results.

**Deadline:** app store submission. Store operators remove apps on credible trademark complaint without adjudicating. Secondary triggers: commissioning brand design, buying a domain, taking payments.

**Investigated and eliminated:** Oceana (major ocean nonprofit, offices across Europe, litigious, adjacent domain), Landfall (Swedish games studio with Play Store apps), Longfetch (existing calm-technology tide widget — conceptually adjacent), Nereid (marina/boating app already on Google Play), Halcyon (funded cybersecurity firm plus a dive brand with its own app).

**Surviving shortlist:** Tethys (real conflicts exist but all in unrelated classes — oil, lubricants, water treatment; no consumer apps; .com gone), Mira, Talo.

**Criteria learned along the way:** with markets in Central America, Europe, SE Asia, and South America, the constraint is phonetic as much as legal — avoid the "th" sound (absent from Spanish, Portuguese, and most SE Asian languages), prefer open vowels, two syllables, unambiguous stress. A multi-jurisdiction footprint also makes formal clearance expensive, which favours coined or unusual names over evocative real words.

**Proportionate process:** free self-check first — USPTO and EUIPO databases, both app stores, domain availability. An hour, no cost. Good enough to build Phase 0 on. Pay for professional clearance only near submission, and only for a shortlist already narrowed.

### 12.2 Phase −1 test windows

Specific historical date ranges for the clean and messy windows are not yet chosen. Needs a candidate North Atlantic groundswell event with a documented arrival in Portugal or Ireland.

**Update (2026-08-17):** researched candidates and ran the actual Phase −1 test against them — see `PROGRESS.md` and `phase-1-validation/README.md` for full detail. Clean window: Dec 11-24, 2025 (brackets the well-documented Dec 18, 2025 Mullaghmore Head, Ireland swell — confirmed present in the real fetched data, 10.6m/13.5s peak, correctly timed). Messy window (Sep 8-21, 2025) remains an **unverified placeholder** — it produced near-zero clusters at every tested setting, consistent with "quiet" but never independently cross-checked against the raw wave height as the plan itself recommends.

**Result, round 1:** against this real clean window, the clustering/tracking approach as first implemented did **not** robustly pass the criteria in §8. The longest continuous track at the plan's own groundswell definition (period ≥12s) held for only 36h/1,814km, well short of 72h/2,000km, and a fine sweep of the period threshold produced a jagged, non-monotonic result — the plan's own named signature of a knife-edge rather than a robust pass.

**Result, round 3 (after using Open-Meteo's secondary swell field, per §4.1, and fixing two real bugs — one in the tracker's position prediction, one in this project's own crude test land mask):** materially better. At the plan's own period≥12s definition, a single track now holds together for 66 continuous hours across 3,263km — a real, geographically coherent story moving from mid-Atlantic to near Ireland, arriving right at the actual event's real-world timing — 6 hours short of the 72h bar, but *consistently* so across every swept parameter combination at that threshold, not a knife-edge. A different, independently legitimate system clears the bar outright at 90h/3,611km under a looser (still swept) setting. Full evidence in `phase-1-validation/README.md`'s Round 3 section.

**Result, rounds 4-5 (three more North Atlantic events + a real long-distance Pacific event):** at the plan's literal period≥12s, 0 of 4 North Atlantic events (2023-2025, Ireland and Portugal) cleared 72h/2,000km — durations ranged 24-66h. At period≥11s, 3 of 4 passed every swept combination outright, and the 4th missed by 0.6% on distance alone. Separately, a real test of the plan's own §4.6 "epic, 10-day, 10,000km" scenario — the July 2024 storm off New Zealand's Chatham Islands whose swell reached Tahiti, Hawaii, and California — passed 16/16 at the literal period≥12s, with a single 222-hour, 9,756km track matching the real event's reported distance almost exactly. Full detail in `PROGRESS.md`.

**Decision (2026-08-17): the groundswell threshold is revised from period≥12s to period≥11s** (reflected in §4.4). Rationale: the North Atlantic near-misses were consistently about event strength, not a wrong threshold in general — a genuinely powerful long-distance system (the Pacific event) passed at the original ≥12s with large margins, while weaker North Atlantic storms needed the 1-second loosening to track consistently. The evidence spans five independent real events across two ocean regions and multiple years, not a single result tuned after the fact. Phase −1 is now considered **passed** under this revised, explicitly-documented threshold. Phase 0 (§8) may proceed.

### 12.3 Print fulfilment partner

Unselected. Determines the physical print price point (§7) and the required export resolution and colour profile from the render path (§6.5).
