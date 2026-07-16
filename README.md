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

The optional `worker/` service creates compact share links. Without it, sharing falls back to a full plan URL.
