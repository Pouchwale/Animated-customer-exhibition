# PouchWale Pouch Configurator

Customers rank requirement topics (Price, MOQ, Delivery Type…) in priority order and get a recommended
option for each admin-defined parameter (Print Type, Material Type…), weighted by that ranking. Admins manage the
topics, parameters, options and each option's star ratings in `/admin`, with no code changes.

```
client/   React 18 + TypeScript + Tailwind 4 + GSAP + Motion + dnd-kit + Locomotive Scroll (Vite), custom bubble physics
server/   Node + Express 5 + TypeScript + Prisma 6 (PostgreSQL)
shared/   Types shared by both (the API contract)
docs/     API reference and suggestion algorithm
```

## Quick start (local)

Requirements: Node 20+ (tested on 22). PostgreSQL is optional. If you don't have it, the project
can run a real Postgres for you via `embedded-postgres`, which downloads binaries on the first run.

**Windows: double-click `start.bat`.** It starts the database, the API and the web app together, then opens the
customer page in your browser.
- **First run:** it installs the packages and creates `server/.env` with a new random `JWT_SECRET`.
- **Port:** the web app uses port 5173, or the next free one (5180–5184) if another app has 5173; the window shows
  the address.
- **Stop:** press Ctrl+C in that window, or close it.
- **Speed:** a normal start takes about 20–30 seconds. The very first start is slower.

```bash
npm install

# Option A: no Postgres installed (one command runs DB + API + web)
npm run dev:all

# Option B: your own Postgres
#   1. set DATABASE_URL in server/.env
#   2. create tables + seed data
npm run setup
#   3. run API + web
npm run dev
```

- Customer page: http://localhost:5173
- Admin panel: http://localhost:5173/admin
- API: http://127.0.0.1:4000/api (on the laptop only; other devices use the web app's address)

Seeded login (the only account the seed creates; the email comes from `ADMIN_EMAIL` in `server/.env`):

| Role | Email | Password | Can |
|---|---|---|---|
| ADMIN | `admin@pouchwale.com` | value of `ADMIN_PASSWORD` in `server/.env` | everything: topics, recommendation parameters and options, intro and idle logo settings |

- **Change the password** with **Change password** in the admin panel (see below) when you first sign in. The
  example password in `server/.env.example` is public.
- **Weak passwords:** in production the seed refuses an `ADMIN_PASSWORD` that is the example one or breaks the
  password rules below. In development it only prints a warning. Once the admin exists, the seed never changes its
  password, so it only warns then.
- **Editors:** the code still has an EDITOR role (it can add, edit and hide topics, but not delete them), but no editor
  account is created: the admin is the only login. (The old `editor@pouchwale.com` login was removed from this
  laptop's database. On another copy, delete it with `npm run prisma:studio -w server`, table `AdminUser`.)

**Change password:** anyone signed in to the admin panel can change their own password with **Change password**, in
the header next to Sign out (a key icon on phones).
- It asks for the current password, then the new one twice.
- The new password needs at least 12 characters. It also can't be your current password, your email, or a repeated
  character like `aaaaaaaaaaaa`.
- After the change, the old password stops working and any other device signed in to that account is signed out.
- Changing `ADMIN_PASSWORD` in `server/.env` later does **not** change an existing account, so use this instead.

**Admin → Recommendations** sets up everything Step 3 recommends:
- **Parameters** (Print Type, Material Type…): each becomes a Step 3 card. Add, rename, reorder, show/hide or delete
  them and their **options** (Flexo, Gravure, Digital…).
- **Ratings:** every option gets 1–5 stars on each priority topic (Price, MOQ, Print Quality…), plus the reason
  customers see next to the stars ("Lowest cost per pouch on very large runs"). A topic left unrated counts as 0 stars
  for that option. The topics themselves (add, rename, reorder, show/hide) are managed in **Priority topics**.
- **How the winner is picked:** each option's score is the average of its stars weighted by the customer's ranking
  (#1 counts most). The best score is recommended; ties go to the option that is better on the higher-ranked topic,
  then to admin order.
- **What customers see:** the recommended option with its overall stars and selling line, then, for each of their
  priorities in their order, its stars and your reason. Below that, under "Your other priorities", the topics they
  didn't rank, greyed out: shown for information only, they don't count. It updates as they rank and reorder:
  - a thin blue bar under each ranked priority shows how much it counts (#1 most);
  - the touched priority's row glows, rows glide to their new places and rank numbers roll ("#2" → "#1");
  - a new pick rolls its name in with a "New best match" sticker; the same pick with a new score shows "↑ Score +0.3";
  - with a mouse, hovering a row tints it; on a narrow screen the stars sit under the name and the reason opens on tap.
- **Try it:** rank the topics like a customer and see what would be recommended, and why. It uses the same scoring as
  the customer page.

**Admin → Priority topics:** editors and admins can add, rename, reorder and hide topics. Only admins see **Delete**.
Deleting a topic also deletes every star rating and reason for it, so the warning suggests hiding it instead
(Edit → Hidden).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev:all` | Embedded Postgres, then migrations and seed, then API and web, with hot reload |
| `npm run dev` | API and web only (DB must be running) |
| `npm run db` | Embedded Postgres only (port 5433, data in `server/.pgdata`) |
| `npm run setup` | `prisma migrate deploy` and the idempotent seed |
| `npm test` | Recommendation engine, API validation and bubble-physics tests (Node test runner) |
| `npm run typecheck` | Strict TypeScript, server and client |
| `npm run build` then `npm start` | Production build. The API also serves `client/dist` |
| `npm run release` | Production: `prisma migrate deploy`, then the built seed (`node dist/seed.js`). Run after `npm run build` |
| `npm run seed:prod -w server` | Production: the built seed only |

## How suggestions work

Customers rank the topics one by one in Step 2: Price, MOQ, Delivery Type, Development Charges, Print
Quality, Special Colour and Quantity Range. Step 3 then recommends one option for every recommendation
parameter. For example, it may recommend Digital Printing under Print Type.

1. **Topics (priority list).** Managed in `/admin` → Priority topics: add, rename, order, show or hide (and, admins
   only, delete).
2. **Parameters and options.** Admins create parameters such as Print Type or Material Type. Each has options
   such as Flexo, Gravure or Digital Printing. Every option is rated 1–5 stars on each topic, with the reason
   customers see. Parameters and options can be enabled or disabled and reordered.
3. **Weights.** Each rank gets fixed points: 100, 80, 60, 40, 20, then 10. Higher-ranked topics therefore have
   more influence.
4. **Matching.** For each parameter, every option's stars on the customer's ranked topics are averaged, weighted by
   those points. The best average wins. Ties go to the option with more stars on the customer's #1 topic, then #2,
   and so on, then the admin's option order.
5. **Why.** The customer sees the winner's stars and reason for each of their priorities, in their order, then
   for the topics they didn't rank (for information only).
6. **Only active topics count.** A ranked topic that has since been hidden or deleted (for example on a page left
   open for hours) is ignored.

Example: Price #1, MOQ #2, Print Quality #3 recommends **Flexo Printing** under Print Type: 4★ on Price, 3★ on MOQ
and 5★ on Print Quality, 3.9 stars overall.

The engine lives in [server/src/engine/](server/src/engine/). It is a pure function with no database
or HTTP code, behind a `SuggestionProvider` interface, so a future AI provider can plug in
(`RECOMMENDER` env var).

Full details: [docs/API.md](docs/API.md).

## Header logo

The logo at the top of the customer page cycles through the brand colourways that read on white: pink → blue → orange
(#fe4587, #149eda, #ff561d, as in the design system's `assets/brand` logos), 12 s per loop. Each colour holds 2.5 s, then
blends into the next over 1.5 s, going round the colour wheel so the in-between shades stay bright. The logo file is
only the shape (a CSS mask, `/logo-pink.png`) and only the colour animates, so the logo never fades or flickers
([client/src/customer/HeaderLogo.tsx](client/src/customer/HeaderLogo.tsx), `.pw-logo-cycle` in `client/src/index.css`).
It is 52 px tall (44 px on phones and in windows 740 px tall or less, so the page still fits one screen). It stays pink
for reduced-motion users. The admin panel, intro and other screens keep the pink logo.

## Brand intro

Every load or reload of the customer site (and every kiosk **Start over**) opens with a ~3s GSAP intro
([client/src/intro/](client/src/intro/)). Choose it in **Admin → Animations → Intro animation**:

| Style | What happens |
|---|---|
| Pouches become the bubbles | The pouches orbit the logo, then each shrinks into a Step 1 bubble and flies to its place on the page. |
| Logo from bubbles | Dots in the brand colours form the logo, which turns crisp, then pour into the Step 1 bubbles. Same family as idle logo mode. |
| Zip opens | The zip pull is cut from the logo, runs across the screen like a zipper, and the screen opens along it: POUCH goes up, WALE goes down. |
| Logo to tagline | The logo settles in; its tear tab lifts out, drops and becomes the underline of "Fueling brand growth through innovative pouches" as the words rise, then snaps back into the logo. |
| Classic orbit | The original: pouches orbit the logo, burst out, and a circle closes onto the logo. |
| Take turns (default) | Each load plays the next of the first three. |

Each style has a **Preview** link (`/?intro=pouches|dots|zip|tagline|classic`). The page loads underneath the intro, so the
"bubbles" styles can land exactly on the real bubbles. If the bubbles aren't ready in time, the intro ends the classic way.
The intro never waits more than 0.7s for the setting; it then uses the last one it saw. Skip with the button, a click,
or Esc/Enter/Space. Reduced-motion users get a short still frame. The admin panel has no intro.

**Tablets (orbit styles):** on a touch screen at least 600 px on its short side, the pouches are smaller and the orbit is
sized from the logo and tagline, so the pouches pass beside them, never over them, and stay on screen
(`orbitGeometry` in [client/src/intro/playOrbit.ts](client/src/intro/playOrbit.ts)). Desktop and phones keep their orbit.

The logo is `assets/brand/logo-pink.png` from the design system. The pouches in `client/public/intro/` are cut out
of the brochure renders (`assets/brochure/05–12`). To refresh them, cut the pouch from the new brochure page,
export as a transparent WebP about 440px tall, and keep the same file name.

## Exhibition iPad (kiosk)

The customer page is tuned for iPad, portrait and landscape:
- **Layout:** Steps 1, 2 and 3 sit side by side on every screen from iPad mini width (744 px) up: iPads in either
  orientation, laptops and desktops. Only phones in portrait stack them, because three columns can't be read at
  that width.
- **One screen:** on every screen at least 744 px wide and 560 px tall, with no maximum width (iPads, laptops and
  desktops), the page fits the screen: each column fills the height, the bubbles shrink to fit, and a long column
  scrolls on its own. Screens up to 820 px tall get tighter rows and cards. Smaller screens scroll the whole page.
- **Narrow columns:** Step 2 rows let long topic names wrap onto two lines, put the level badge underneath, and move
  the remove × to the row's corner, and the bubbles use a compact size (`index.css` variants `tab-narrow`, `tab`,
  `fit`; container queries in `Workspace.tsx` and `Suggestions.tsx`).
- **Touch:** finger drags start at once, targets are finger-sized, fields don't trigger zoom, and long-press popups are off.

- **Full screen button** (top right): hides Safari's tabs, address bar and toolbar. Safari keeps a small X to leave
  full screen. Leaving full screen or reloading brings the browser controls back.
- **Home Screen app** (no browser controls at all): in Safari tap Share → Add to Home Screen, then open PouchWale
  from the Home Screen. To stop visitors leaving the app, turn on iPad Guided Access (Settings → Accessibility →
  Guided Access, then triple-click the top button).
- **Kiosk mode** turns on automatically in full screen or the Home Screen app, or with `?kiosk=1`:
  - A **Start over** button appears.
  - Pinch-zoom and pull-to-refresh are blocked.
  - After **90 seconds** without a touch it shows a 10-second countdown, clears the visitor's choices and replays
    the intro as an attract screen.
  - Change the timeout with `?idle=SECONDS` (minimum 15).

### If something goes wrong

The customer page is built to keep going at a stall:
- **Crash:** instead of a blank page, a "Something went wrong." screen appears with **Start over**. In kiosk mode it
  starts over by itself after 15 seconds. If it crashes again within a minute of starting over, the next Start over
  reloads the page.
- **Wi-Fi drops:** customers see "Can’t reach PouchWale right now. Check the Wi-Fi — we’ll keep trying." It retries
  by itself (after 2, 4 and 8 seconds, then every 15 seconds, and at once when the iPad is back online).
- **Step 3 can't update:** the previous result stays on screen, dimmed, with "Couldn’t update — showing your
  previous result." and a **Retry** button.
- **Slow network:** every request gives up after 10 seconds, so a screen never waits forever.
- Code: [client/src/kiosk/CrashScreen.tsx](client/src/kiosk/CrashScreen.tsx),
  [client/src/api/client.ts](client/src/api/client.ts).

### iPad tilt

On an iPad the header shows **Allow motion**. Tap it and choose **Allow**: the bubbles roll toward whichever edge
is tilted down, and the button becomes a **Tilt on / off** switch.
- **Level:** tilt is measured from the iPad's resting angle, so a stand at any angle counts as level. A tilt held for
  a while slowly becomes the new level.
- **Kiosk:** tilt stays on through **Start over**; after a reload the iPad asks again. Tilting counts as using the
  screen, so the ghost hand, idle logo and auto-reset wait.
- **Dragging:** the dragged bubble ignores tilt and stays under the finger.
- **If refused or unavailable:** if someone taps "Don't Allow", the page works as normal; reload and tap Allow motion
  again. Android shows the switch directly. Desktops, devices without sensors and Reduce Motion show nothing.
- **HTTPS only:** Safari only gives motion data over HTTPS, so the button never appears on
  `http://<laptop-ip>:5173`. Use the deployed (HTTPS) site.
- Code: [client/src/customer/tilt/](client/src/customer/tilt/); the physics is in `physics.ts`, `tilt` /
  `tiltGravity`.

### Sound effects

Soft "bloops", synthesized with Web Audio (no audio files). Sound is **on by default**: on every page load and again
after **Start over**, even if the previous visitor turned it off. Browsers only allow audio after the visitor's first
touch, click or key, so it starts then. The header's **Sound** button turns it off (and on again, with a short
confirmation bloop).
- **Sounds:**
  - a bubble landing in Step 2 pops, one note higher for each ranked bubble;
  - letting go of a drag gives a low drop;
  - taking a bubble out gives a falling bloop;
  - bubbles hitting each other give light taps.
- **Limits:**
  - only real hits sound, so drifting or piled-up (tilted) bubbles stay quiet;
  - at most one tap per frame, 80 ms apart, a budget of 3 at once plus 6 per second, and 4 voices at a time.
- **Silence:** nothing plays during the intro or the idle logo, in a hidden tab, or 3.5 s after the last touch or tilt
  (so the ghost-hand demo is silent).
- **iPad:** the first touch starts audio, and a later touch resumes it after an interruption. While sound is on, it
  plays even with the iPad's Silent switch on (`navigator.audioSession.type = 'playback'`, Safari 16.4+).
- Code: [client/src/customer/sound/](client/src/customer/sound/).

### "Your pouch is ready"

When a visitor ranks the last topic, a short celebration plays once the bubble has landed (about 4 s):
1. The Step 1 bubbles burst, in rank order, into mini-pouch confetti in their own colours.
2. The confetti swirls into a big PouchWale pouch, which has the visitor's ranking as a colour stripe.
3. The pouch zips shut, and **Your pouch is ready** stamps in with a **See my recommendations** button.
4. It closes by itself: the bubbles pop back into Step 1, and Step 3 is scrolled into view and glows.

Details:
- **When:** every time the list becomes complete. Taking a topic out and ranking it again (or **Clear all** and
  ranking everything again) replays it. Reordering a complete list doesn't, and neither does a fully ranked list
  restored on reload.
- **Skip:** a tap anywhere, or Esc.
- **Sound** (if it's on): rising pops, a zip and a soft ding.
- **Reduced motion:** just the sealed pouch and the message, fading in and out.
- Code: [client/src/customer/PouchReady.tsx](client/src/customer/PouchReady.tsx).

### Ghost-hand demo

While Step 2 is empty, 4 seconds without a touch makes a hand appear: it presses a bubble, drags it into Step 2
(which lights up as for a real drop), lets go, and the bubble floats back. Nothing is ranked. It repeats every ~12
seconds while nobody touches the screen, never plays over the intro or the idle logo, stops the moment
anyone touches the screen (that touch works as normal), and stays off once something is ranked or when the device
asks for reduced motion ([client/src/customer/GhostHandDemo.tsx](client/src/customer/GhostHandDemo.tsx)).

### Idle logo mode

When nobody touches the screen for a while, the Step 1 bubbles drift together, burst into dots in their own
colours, and the dots fly into the PouchWale logo. The first touch (or click, key or scroll) scatters the dots and
the bubbles pop back; that touch never presses anything underneath. If nobody touches, the logo turns back into
bubbles after the hold time, and the cycle repeats after the next idle period.

Set it up in **Admin → Animations → Idle logo** (admins only): on/off, idle time (minutes), animation duration (seconds),
transition speed (Slow / Normal / Fast) and how long the logo stays (0 = until touched). Open pages pick up
changes within a minute, with no reload. To try it without waiting, open `/?idleLogoPreview=1`: the logo forms
after a few seconds with the saved settings, even when the mode is off. With reduced motion turned on, the logo
simply fades in and out.

The iPad needs a connection to the API. At the stall, use a deployed URL, or run `start.bat` on a laptop on the
same Wi-Fi or hotspot and open the "Network:" address it prints (`http://<laptop-ip>:5173`) on the iPad.

## Design

The visuals follow the PouchWale design system in `.claude/skills/pouchwale-design-system`: the four
brand colours, Mada and Mulish type, ink borders and hard "stamp" shadows. It is used in a calmer,
white-field form so the bubbles stay the focus. Motion respects `prefers-reduced-motion`.

**Motion system** ([client/src/motion.ts](client/src/motion.ts)):
- **Durations:** fast (150 ms) for presses, hovers and exits; base (250 ms) for panels and text; slow (400 ms) for
  reveals.
- **Easings and springs:** the brand easings `--ease-pw` and `--ease-bounce`, plus named springs for physical things
  (rows, pops, the Step 3 morph).
- **Transform and opacity only,** so it stays smooth on iPad while the bubble physics runs:
  - Step 2 rows slide into place instead of animating their height.
  - The Step 3 placeholder morphs into the result card.
- New animations should use these tokens rather than their own numbers.

Scrollbars are hidden everywhere: the customer page, the admin panel, and the tablet columns that scroll on their
own. Touch, mouse wheel, trackpad and keyboard scrolling all work as usual (see the base layer in `client/src/index.css`).

## Smooth scrolling

On computers with a mouse or trackpad, every page, the customer site and the admin panel, uses
**Locomotive Scroll v5** ([client/src/scroll/smoothScroll.ts](client/src/scroll/smoothScroll.ts)), started once in
`main.tsx`.

- **Why v5:** it's built on Lenis, which smooths the browser's native scrolling rather than moving the page with
  transforms. Fixed overlays, sticky columns and drag-and-drop keep working unchanged.
- **GSAP:** it runs on GSAP's ticker, so the intro and the scrolling share one animation clock.
- **What is smoothed:** mouse wheel and trackpad. Scrollable areas inside the page (the iPad landscape columns)
  keep their own scrolling.
- **Mouse only:** it only loads on devices with a mouse or trackpad. iPads and phones never download it and scroll
  natively.
- **When it's off:** scrolling is paused while the intro plays, and it isn't started at all for visitors who
  prefer reduced motion.

## Network settings (`server/.env`)

These are optional. Blank or missing means the default, so an older `server/.env` without them works as before.
The defaults differ between development (`start.bat`, `npm run dev`) and production (`NODE_ENV=production`).

| Setting | Development | Production | What it does |
|---|---|---|---|
| `HOST` | `127.0.0.1` | `0.0.0.0` | The address the API listens on. `127.0.0.1` means only the laptop itself can reach it; iPads use the web app's address, which passes `/api` on to the API. `0.0.0.0` means every network. |
| `HTTPS` | `false` | `true` | Whether the site is served over HTTPS (directly or by a proxy in front). When on, sign-in cookies are Secure (sent over HTTPS only) and browsers are told to always use HTTPS (HSTS and upgrade-insecure-requests). |
| `TRUST_PROXY` | `false` | `1` | How many proxies in front of the API to believe about the visitor's IP address (used by the rate limits). Also accepts `true`/`false` or a list of addresses (e.g. `10.0.0.0/8,loopback`). Avoid `true`: anyone could then fake their IP. |
| `KEEP_ALIVE_TIMEOUT_MS` | `65000` | `65000` | How long an idle connection stays open, in milliseconds. Keep it above a load balancer's idle timeout. |
| `HEADERS_TIMEOUT_MS` | `66000` | `66000` | How long the server waits for a request's headers, in milliseconds. Must be greater than `KEEP_ALIVE_TIMEOUT_MS`. |
| `KEEP_ALIVE_URL` | off | Render's own address | The keep-alive ping (see **Hosting on Render** below). Empty: on by itself on Render, off elsewhere. A URL: ping that site instead (e.g. your own domain). `false`: off. |
| `KEEP_ALIVE_MINUTES` | `10` | `10` | How often the keep-alive ping runs, 1–14 minutes. |

The server refuses to start when `HTTPS`, `TRUST_PROXY` or a timeout has an invalid value, and says which.

**Plain HTTP at a stall:** if a production build is ever served over plain `http://` (for example from a laptop on
the stall Wi-Fi), set `HTTPS=false`, or sign-in won't work. Also set `TRUST_PROXY=false` when nothing sits in front
of it.

## Security at the stall

- **The web app is on the Wi-Fi by design.** The web app's dev server (what `start.bat` runs) can be reached by
  other devices on the same network, so the iPads can connect. It only serves the client, the shared code and the
  libraries. It refuses `.env` files, the database folder, `server/backups` and other project files (`server.fs` in
  [client/vite.config.ts](client/vite.config.ts)).
- **The API listens only on the laptop** (`HOST=127.0.0.1`). iPads reach it through the web app's address.
- **Change the admin password.** Anyone on the same Wi-Fi can open the admin sign-in page, so replace the example
  password with **Change password** in the admin panel.
- **Keep backups private.** `server/backups` holds copies of the database. Don't share that folder.

## Hosting on Render (keep-alive)

Render's free web services go to sleep after 15 minutes without visitors; the next visitor then waits about a minute.
To stop that, the server pings its own public health page (`/api/health`) every 10 minutes, a small built-in cron job
([server/src/keepAlive.ts](server/src/keepAlive.ts)). The ping goes through Render's front door like a visit, so the
service never goes idle.
- **Nothing to set up:** Render gives every web service its address (`RENDER_EXTERNAL_URL`), and the ping uses it.
  After deploying, the logs show `[keep-alive] pinging https://….onrender.com/api/health every 10 min`.
- **Not on Render** (your laptop, `start.bat`): it stays off.
- **Free hours:** a free Render workspace has 750 instance hours a month. One service awake all month uses about 744,
  so keep only one free service awake.
- **Backup (optional):** a free outside monitor such as UptimeRobot or cron-job.org checking the same `/api/health`
  every 5–10 minutes also works, and would wake the service if it ever went to sleep (for example after a restart
  that failed).

## Production notes

The owner runs the app with `start.bat` today. If you ever run a production build:
- Set `NODE_ENV=production`, a long random `JWT_SECRET` (32+ chars), a real `DATABASE_URL`, and your own
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` before the first `npm run release`. Check the network settings above too.
- **Steps:** `npm install`, `npm run build`, `npm run release`, then `npm start`.
  - `npm run release` runs `prisma migrate deploy`, then the built seed (`node dist/seed.js`).
    `npm run seed:prod -w server` runs only the seed.
  - The Prisma CLI is a dev dependency, so run `release` where dev dependencies are installed.
  - The seed needs `ADMIN_EMAIL` and `ADMIN_PASSWORD` on every run, and refuses a placeholder or weak password.
- **Start-up checks:** the server refuses to start with the example `JWT_SECRET`, one shorter than 32 characters, or
  one with fewer than 10 different characters. It only warns when `DATABASE_URL` uses the example
  `postgres`/`postgres` login, or when there is no client build (then only the API is served).
- **Health checks:** point a load balancer or monitor at `/api/ready`, which checks the database (503 when it can't
  be reached). `/api/health` is liveness only: it says the process is up, without touching the database.
- **Rate limit:** at most 600 API requests a minute per IP address (429 after that). Health checks don't count. It is
  off in development.
- **Caching:** hashed files in `/assets` are cached for a year. `index.html` is not cached, so a new build shows on
  the next load.
- Session cookies are `httpOnly` and `sameSite=strict`, and Secure when `HTTPS` is on (the production default).
- Every response has an `X-Request-Id` header. In production the server logs one JSON line per request with it.
- `npm audit` reports one advisory in the Prisma CLI's `deepmerge-ts`. It is a dev-time tool and is
  not loaded by the running app.
