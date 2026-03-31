# UQ Semester Tracker

Built this because there wasn't a reliable degree tracker that actually worked. It lets you map out 8 semesters, tracks prerequisites, and automatically calculates core and elective requirements so you don't have to. Currently only for Software engg w an AI minor, but planning to add more later.

Live app: [uq-tracker.vercel.app](https://uq-tracker.vercel.app)

## Features
- **Drag & drop:** Move courses from the catalog straight into your semesters.
- **Prereq checking:** Hovering over a course highlights its prerequisites and dependents.
- **Progress tracking:** Calculates remaining units for your core, AI minor, and electives.
- **Availability checking:** Pulls data to show if a course is offered in Sem 1, Sem 2, or both.
- **State management:** Auto-saves in the browser and supports undo/redo.
- **Share & Export:** Share a link to your plan or export it as an image.
- **Dark mode:** Included by default.

## Under the hood
- Built with vanilla JS and CSS. No heavy frameworks.
- `index.html`, `app.js`, `styles.css` handle the frontend.
- `data.js` holds degree rules and course metadata.
- `scripts/scrape.js` pulls course data from UQ's official pages.

## Running locally
1. Clone the repo: `git clone https://github.com/dhirenmalik/uq-tracker.git`
2. Open `index.html` in a web browser. No build steps needed.
