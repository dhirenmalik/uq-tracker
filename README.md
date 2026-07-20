# UQ Tracker

A browser-based degree planner for University of Queensland students. Build a semester-by-semester study plan, track requirement progress, and check course order against current UQ course information.

[Open UQ Tracker](https://uq-tracker.vercel.app)

## What it supports

UQ Tracker loads program, major, minor, and course data from UQ and turns it into an interactive plan. It supports drag-and-drop planning, additional study years, selected summer semesters, dual majors where available, prerequisite checking, and browser-based autosave.

Requirement allocation follows two principles:

- A course can count towards only one requirement.
- Compulsory requirements take priority over elective requirements.

The planner also handles known course equivalencies and transition rules, including legacy Computer Science plans and the Software Engineering with AI minor pathway.

UQ course offerings and program rules can change. Treat the tracker as a planning aid and confirm important decisions against the official UQ course catalogue and program rules.

## Development

The app uses vanilla HTML, CSS, and JavaScript with no frontend build step.

```sh
git clone https://github.com/deerainn/uq-tracker.git
cd uq-tracker
npm test
```

Serve the repository with any static web server, then open `index.html`. A server is recommended because the app fetches live UQ data through its configured proxy.

The main logic is split between:

- `scraper.js` for UQ program and course data
- `degreeRules.js` for requirement and transition rules
- `prerequisiteGraph.js` for prerequisite validation
- `app.js` for planner state and interaction

## Short-link worker

The optional Cloudflare Worker stores short links across Redis REST shards. A 150-virtual-node consistent-hash ring selects each shard with an O(log N) lookup; fallback reads lazily migrate the small set of keys that move after a shard change.

Configure either one Redis instance with `REDIS_REST_URL` and `REDIS_REST_TOKEN`, or multiple instances with a `REDIS_SHARDS_JSON` secret:

```json
[{"id":"redis-a","url":"https://example.upstash.io","token":"..."}]
```

Authenticate Wrangler, add the secret, and deploy:

```sh
npx wrangler login
npx wrangler secret put REDIS_SHARDS_JSON --config worker/wrangler.toml
npm run deploy:worker
```

Set the deployed Worker origin in the `uqtracker-shortener-url` meta tag in `index.html`. If no worker is configured, sharing falls back to a full plan URL.
