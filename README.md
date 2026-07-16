# UQ Semester Tracker

Built this because there wasn't a reliable degree tracker that actually worked. It lets you map out 8 semesters, tracks prerequisites, and automatically calculates core and elective requirements so you don't have to. Currently only for Software engg w an AI minor, but planning to add more later.

Live app: [uqtracker.vercel.app](https://uqtracker.vercel.app)

## Features
- **Drag & drop:** Move courses from the catalog straight into your semesters.
- **Prereq checking:** Hovering over a course highlights its prerequisites and dependents.
- **Progress tracking:** Calculates remaining units for your core, AI minor, and electives.
- **Transition plans:** Use a rules year with a start year up to two years earlier, including the 2026 Software Engineering + AI transition rules.
- **Single-course allocation:** Courses shared by elective lists can be assigned to exactly one requirement bucket.
- **Availability checking:** Pulls data to show if a course is offered in Sem 1, Sem 2, or both.
- **State management:** Auto-saves in the browser and supports undo/redo.
- **Share & Export:** Share a link to your plan or export it as an image.
- **Short share links:** Optionally uses the Cloudflare Worker shortener to keep plan URLs compact.
- **Dark mode:** Included by default.

## Under the hood
- Built with vanilla JS and CSS. No heavy frameworks.
- `index.html`, `app.js`, `styles.css` handle the frontend.
- `data.js` holds degree rules and course metadata.
- `scripts/scrape.js` pulls course data from UQ's official pages.
- `worker/` contains the optional Redis-backed Cloudflare URL shortener.

## Running locally
1. Clone the repo: `git clone https://github.com/dhirenmalik/uq-tracker.git`
2. Open `index.html` in a web browser. No build steps needed.

## Short link backend
The app falls back to long hash URLs unless a shortener endpoint is configured.

Set the `uqtracker-shortener-url` meta tag in `index.html` or define `window.UQ_TRACKER_SHORTENER_URL` before `app.js` loads. The endpoint should point to the deployed Worker origin, for example `https://uqtracker-shortener.example.workers.dev`.

The Worker expects Redis REST credentials through either:
- `REDIS_SHARDS_JSON`: JSON array of `{ "id": "redis-a", "url": "https://...", "token": "..." }`
- or `REDIS_REST_URL` plus `REDIS_REST_TOKEN` for a single shard

It routes short-code keys through a consistent hash ring with 150 virtual nodes per shard so adding or removing Redis shards remaps only a limited slice of keys.
