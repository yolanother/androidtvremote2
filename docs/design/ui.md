<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Design direction for the Android TV Remote web UI. Records the competitive research
(Google TV, Roku, SmartThings, Google Home, Tesla, YouTube) that the interface is built
from, the layout model and interaction rules derived from it, the D-pad and touchpad
geometry, the accessibility and keyboard contract, and the places where this build
deliberately deviates from the reference apps. Read this before changing anything under
web/src/components.
-->

# Web UI design direction

## The one sentence

**This is a physical remote that happens to run in a browser — not a dashboard with
buttons on it.**

Everything below follows from that. A dashboard is read; a remote is *operated*, in the
dark, one-handed, without looking at it. That reverses the usual priorities: hit-target
size beats information density, muscle memory beats discoverability, and instant tactile
feedback beats a correct-but-late confirmation.

## Research

Studied via the Mobbin MCP tools. What was actually taken from each:

| App | Screen | What was taken |
|---|---|---|
| **Google TV** | [remote](https://mobbin.com/screens/7088a28e-ebad-46ed-9caa-ef55e6054924) | Circular D-pad **ring** with an oversized center OK. Device identity + `Connected` status as a compact tappable header. Volume as a single segmented pill at the bottom. An explicit *"Swipe control / D-pad control"* mode switch. |
| **Roku** | [remote](https://mobbin.com/screens/927dd97a-852a-4e68-9775-0c7d6261a403) | Device header carrying model + a green `● Connected` dot. Back/Home as a dedicated row *above* the pad. Transport as a distinct cluster *below* it. |
| **SmartThings** | [touchpad](https://mobbin.com/screens/aacb5afb-0aef-4144-aaa0-d091c12f6a51) | The touchpad as a large, deliberately **empty** rounded rectangle that owns the middle of the screen; back/home/next persist below it, unchanged, across the mode switch. |
| **Google Home** | [devices](https://mobbin.com/screens/9338c84f-8c3f-4256-bfb2-c7c31515df08) | Device tiles where the **tint encodes state** — an offline device is desaturated *and* carries a warning glyph *and* says "Offline". Three redundant channels, never colour alone. |
| **Tesla** | [product switcher](https://mobbin.com/screens/89a757b5-c1b6-4e5a-afbd-8c0c4e34da0f) | The device switcher as a sheet that drops from the header title, with "+ Add" as the last row. |
| **YouTube** | [Link with TV code](https://mobbin.com/screens/9c848e10-be78-4f44-9bee-f25aea637571) | The pairing dialog: one prominent bordered code field, a **numbered "how to get the code"** list right beneath it, and a CTA that stays disabled until the code is well-formed. |

### What the references get right, and why

Every one of these apps puts **connection state in the header, permanently**. None of them
make you go looking for it. A remote whose keypresses are silently going nowhere is worse
than a remote that is obviously offline, so status is never more than a glance away.

All of them also keep the **navigation cluster fixed while the content above it changes**.
Google TV and SmartThings swap the middle of the screen between D-pad and touchpad while
back/home/transport stay exactly where your thumb left them. That is the single most
important layout decision here and it is copied directly.

## Deliberate deviations

1. **The surface switch is a visible tab bar, not an overflow menu.** Google TV hides
   `Swipe control / D-pad control` behind a `⋮`. That works when there are two modes and a
   decade of platform convention. We have **four** surfaces (D-pad, touchpad, text, apps),
   the text surface is the headline feature over a physical remote, and the web has no
   convention to lean on. Hiding them would bury the reason to use this over the plastic
   remote in the drawer. So: a persistent 4-tab bar, in the thumb zone.

2. **Circular ring D-pad, not Roku's cross.** On a 390px viewport the ring reads as one
   moulded physical part, and the wedge hit regions extend all the way to the diagonals —
   every arrow gets a ~120° sector instead of a rectangle with dead corners. The cross
   shape wastes its corners.

3. **No web font.** The design-system tool recommended Plus Jakarta Sans. Rejected: this
   is a LAN appliance that may have no route to the internet, and a remote that blocks on
   `fonts.googleapis.com` is a remote that doesn't open. System font stack only.

4. **Light mode is supported.** The reference remotes are dark-only. This one runs on a
   wall-mounted panel in a bright kitchen as readily as on a phone at night, so both
   themes are first-class, following `prefers-color-scheme` with a manual override.

## Layout model

The app frame is `100dvh` and **never scrolls**. Only inner panels (the app grid, the
device list) scroll. This is non-negotiable: a page that rubber-bands while you are
swiping a touchpad is unusable.

```
┌─────────────────────────────┐
│ HEADER   name ▾   ● status  │  tap name → device switcher sheet
├─────────────────────────────┤
│                             │
│           STAGE             │  swaps: D-pad │ Touchpad │ Text │ Apps
│      (flex-1, centred)      │  the only region that changes
│                             │
├─────────────────────────────┤
│  ← back    ⌂ home    ⏻ pwr   │  DECK — fixed across all four surfaces
│  ⏮  ⏯  ⏭                     │
│  [ 🔇 │ vol− │ vol+ ]        │  segmented pill (Google TV)
│  ┌───┬───┬───┬───┐          │
│  │dpad│pad│txt│app│         │  surface tabs, thumb zone
└─────────────────────────────┘  + safe-area inset
```

Everything below the stage lives in the bottom third — the thumb arc on a phone held
one-handed. Nothing interactive sits in the top corners except the device menu, which is
a deliberate, two-handed action.

Tablet and desktop widen the frame and place the deck alongside rather than beneath, but
the *order of operations* never changes, so muscle memory transfers.

## Control geometry

### D-pad

- Outer ring **280px**, centre OK **120px**. Each arrow wedge is a 90° sector clipped from
  the ring, so its smallest dimension is ~80px — comfortably past the 44px floor, and the
  diagonal boundaries mean a sloppy thumb still lands on *something* sensible.
- Built as four real `<button>` elements clipped with `clip-path: polygon(...)` plus a
  fifth centred button. **Not** a div with an `onClick` and pointer maths: keyboard focus,
  `aria-label`, and screen-reader semantics all come free, and a wrong tap is impossible
  to misattribute.
- **Press-and-hold repeats**: 400ms delay, then a key every 120ms. That is the interval a
  list scroll feels continuous at without overshooting by three rows when you let go.
- **Haptics**: `navigator.vibrate(8)` per emitted key where supported. Eight milliseconds
  is a tick, not a buzz — it confirms the press without being felt as vibration.

### Touchpad

- A large empty rounded rectangle, per SmartThings. Emptiness is the affordance; anything
  drawn inside it invites tapping *at* something rather than swiping.
- **Tap** (< 10px of travel, < 300ms) → `DPAD_CENTER`.
- **Swipe** → keys are emitted *during* the drag, one per **56px** of travel along the
  dominant axis, so a long swipe scrolls several rows exactly like Google TV's swipe mode.
  Emitting once on release would make the pad feel dead.
- The dominant axis is locked on first emission so a diagonal drift can't flip you
  sideways mid-scroll.

### Volume

One segmented pill: `mute │ − │ +`. Volume is the most-repeated action on any remote, so
it gets permanent bottom-edge real estate and press-and-hold repeat at the same cadence as
the D-pad.

## Reactivity

- **The UI never polls.** One `useRemoteSocket()` owns `/api/ws`, applies the `snapshot`
  frame, then folds every delta into a single store. Reconnect is exponential backoff
  (1s → 15s) with a heartbeat `ping`.
- **Optimistic where the echo is slow, never where it lies.** Mute and power flip locally
  the instant you press, then the next `device.state` frame confirms or corrects them.
  Directional keys are not optimistic — there is no local state to predict — so they get a
  *press flash* instead: the key face lights for 90ms on emit. Feedback is immediate;
  truth still comes from the TV.
- **No spinner flashes.** Transitions under 200ms show nothing at all. A spinner that
  appears and vanishes in 80ms reads as a glitch, not as progress.
- **No layout shift.** State changes swap colour, tint, and glyph — never size or
  position. Status text is width-reserved.

## Colour and tactility

The scaffold's zinc token set is kept as-is (it is shadcn-compatible and already carries
`--online` / `--offline` / `--pairing`). Two tokens are added for the physical feel:
`--key` and `--key-active`, the key face and its pressed state.

Keys read as moulded objects: a one-pixel border, a soft top-light gradient, and a press
state that moves the face **down 1px with an inset shadow** — the way a real button
travels. Never a `scale()` transform; that shifts neighbouring layout and reads as a web
animation rather than a physical press.

State colour is never the only signal. `connected` is a green dot **and** the word
"Connected"; `unpaired` is amber **and** a lock glyph **and** an actionable "Re-pair"
button.

## Accessibility contract

- Every control is a real `<button>`. Every icon-only control has an `aria-label`.
- Focus is visible everywhere (`:focus-visible`, 2px ring, 2px offset) — including on the
  D-pad wedges, which are frequently the first thing a keyboard user tabs into.
- Connection and pairing status changes are announced through an `aria-live="polite"`
  region.
- **Full keyboard operation on desktop**, so the remote is usable from a laptop without
  touching the mouse:

  | Key | Action |
  |---|---|
  | `↑ ↓ ← →` | D-pad directions |
  | `Enter` | OK / select |
  | `Escape`, `Backspace` | Back |
  | `h` | Home |
  | `Space`, `k` | Play / pause |
  | `+` / `-` | Volume up / down |
  | `m` | Mute |
  | `[` / `]` | Previous / next |

  Bindings are suppressed while focus is in a text field, so the text surface still types
  normally. Held keys repeat at the same 120ms cadence, and `keydown` auto-repeat from the
  OS is ignored in favour of our own timer so the rate is consistent across platforms.

- `prefers-reduced-motion` removes the press-flash animation; the colour change stays.

## Text entry — the reason this exists

Typing "the eleven-part documentary about naval history" on an on-screen keyboard with a
D-pad is the worst experience in consumer electronics. Beating it is the single biggest
win this app has over the physical remote, so the text surface gets more care than its
size suggests:

- A real `<input>` with a `Send` button; **Enter sends**.
- A **Paste** button (`navigator.clipboard.readText()`) — pasting a title from a browser
  tab is the actual use case.
- `DEL` and `ENTER` key buttons beside the field, because the TV's own field usually needs
  clearing before it needs filling, and search boxes need a submit that isn't text.
- The field keeps focus after sending, so successive queries don't need a re-tap.

## Device management

- The **dashboard** is Google Home's tile model: one tile per device, tinted by state,
  with power state and current app as the subtitle. Tapping a tile opens its remote.
- **Adding** a device offers discovered TVs first (`GET /api/discovery`, refreshed by
  `POST /api/discovery/scan` with results arriving over the socket) and a manual IP field
  as the fallback — never the other way round.
- **Pairing follows the YouTube pattern**: explain that a code has appeared on the TV
  *before* showing the field, a single 6-character input, driven entirely off the
  `pairing` socket frames, with `failed` and `timeout` each getting a distinct message and
  a visible Retry. A device that reports `unpaired` later (auth revoked at the TV) surfaces
  an actionable "Re-pair" prompt in place of its controls rather than failing keypresses
  silently.
