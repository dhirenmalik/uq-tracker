document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

let state = {
    courses: [...COURSES],     // Master list
    placements: {},            // code -> semester id
    activeFilter: 'All',
    searchQuery: '',
    loadingSemesters: true
};

async function initApp() {
    loadState();

    // Draw UI immediately
    renderSemesters();
    renderCatalog();
    updateProgress();

    // Setup Event Listeners
    document.getElementById('courseSearch').addEventListener('input', e => {
        state.searchQuery = e.target.value.toLowerCase();
        renderCatalog();
    });

    const filterBtns = document.querySelectorAll('.filter-pill');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeFilter = btn.dataset.cat;
            renderCatalog();
        });
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
        if (confirm("Are you sure you want to reset your plan?")) {
            state.placements = {};
            saveState();
            renderSemesters();
            renderCatalog();
            updateProgress();
        }
    });

    // Global drop zone events for unassigned list
    const unassignedList = document.getElementById('unassignedList');
    unassignedList.addEventListener('dragover', handleDragOver);
    unassignedList.addEventListener('drop', handleDrop);
    unassignedList.addEventListener('dragenter', handleDragEnter);
    unassignedList.addEventListener('dragleave', handleDragLeave);

    // Fetch availability asynchronously
    await fetchSemestersForAll();
}

async function fetchSemestersForAll() {
    const promises = state.courses.map(async course => {
        try {
            const formBody = `search-term=${course.code}&semester=ALL&campus=ALL&faculty=ALL&type=ALL&days=1&days=2&days=3&days=4&days=5&days=6&days=0&start-time=00%3A00&end-time=23%3A00`;

            // Helper function to fetch for a specific year
            const fetchForYear = async (year) => {
                const response = await fetch('https://lingering-bush-c27d.late-night.workers.dev/?/subjects', {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json, text/javascript, */*; q=0.01',
                        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'year': year.toString()
                    },
                    body: formBody
                });
                const data = await response.json();
                const sems = new Set();

                Object.keys(data).forEach(key => {
                    if (key.toUpperCase().startsWith(course.code)) {
                        const semStr = data[key].semester; // e.g., 'S1', 'S2'
                        if (semStr === 'S1') sems.add(1);
                        if (semStr === 'S2') sems.add(2);
                        if (semStr === 'S3') sems.add(3);
                    }
                });
                return Array.from(sems).sort();
            };

            // Try current/future year first
            let semsList = await fetchForYear(2024);

            // Fallback: If no semesters found in 2024, check historical data from 2023
            if (semsList.length === 0) {
                console.log(`${course.code} not found in 2024. Falling back to 2023...`);
                semsList = await fetchForYear(2023);
            }

            course.semesters = semsList;
        } catch (e) {
            console.error(`Failed to fetch for ${course.code}`, e);
            course.semesters = [1, 2]; // ultimate fallback
        }
    });

    await Promise.all(promises);
    state.loadingSemesters = false;

    // Re-render once we have constraints
    renderCatalog();
    renderSemesters();
}

function loadState() {
    const saved = localStorage.getItem('uq_tracker_state');
    if (saved) {
        try {
            state.placements = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse state', e);

        }
    }
}

function saveState() {
    localStorage.setItem('uq_tracker_state', JSON.stringify(state.placements));
}

// ---------------- UI Rendering ----------------

function renderSemesters() {
    const grid = document.getElementById('semestersGrid');
    grid.innerHTML = ''; // clear

    SEMESTERS.forEach(sem => {
        const box = document.createElement('div');
        box.className = 'semester-box';

        // Sem header
        const header = document.createElement('div');
        header.className = 'semester-header';
        header.innerHTML = `
      <div class="semester-title">${sem.name}</div>
      <div class="semester-units" id="units-${sem.id}">0 / 8 units</div>
    `;

        // Dropzone
        const dropzone = document.createElement('div');
        dropzone.className = 'semester-dropzone';
        dropzone.id = sem.id;
        dropzone.dataset.semester = sem.id;

        dropzone.addEventListener('dragover', handleDragOver);
        dropzone.addEventListener('drop', handleDrop);
        dropzone.addEventListener('dragenter', handleDragEnter);
        dropzone.addEventListener('dragleave', handleDragLeave);

        // Get all courses placed in this semester (either normally or as a ghost)
        const placedCodes = Object.keys(state.placements).filter(code => {
            const placement = state.placements[code];
            if (Array.isArray(placement)) {
                return placement.includes(sem.id);
            }
            return placement === sem.id;
        });

        let units = 0;

        placedCodes.forEach(code => {
            const cInfo = getCourseInfo(code);
            if (cInfo) {
                // If year long, it's 2 units per semester
                const semUnits = cInfo.isYearLong ? (cInfo.units / 2) : cInfo.units;
                units += semUnits;

                const card = createCourseCard(cInfo);

                // If it's a yearlong course and this is the second semester it appears in, mark it
                if (cInfo.isYearLong && Array.isArray(state.placements[code])) {
                    if (state.placements[code][1] === sem.id) {
                        card.querySelector('.course-name').innerHTML += ' <span style="color: var(--accent-color); font-weight: bold;">(Part 2)</span>';
                        // Keep Part 2 as non-draggable to force moving only the parent
                        card.draggable = false;
                        card.style.opacity = '0.7';
                        card.style.cursor = 'default';
                        card.removeEventListener('dragstart', handleDragStart);
                        card.removeEventListener('dragend', handleDragEnd);
                    }
                }

                // Set the displayed units on the card to the split unit amount
                card.querySelector('.course-units').innerText = `${semUnits} U`;

                dropzone.appendChild(card);
            }
        });

        header.querySelector('.semester-units').innerText = `${units} / 8 units`;
        if (units > 8) header.querySelector('.semester-units').style.color = '#ef4444'; // Red if overloaded

        box.appendChild(header);
        box.appendChild(dropzone);
        grid.appendChild(box);
    });
}

function renderCatalog() {
    const unassignedList = document.getElementById('unassignedList');
    unassignedList.innerHTML = '';

    state.courses.forEach(c => {
        // skip if placed
        if (state.placements[c.code] && state.placements[c.code] !== 'unassigned') return;

        // Filter rules
        const matchCat = state.activeFilter === 'All' || c.cat === state.activeFilter;
        const matchSearch = c.code.toLowerCase().includes(state.searchQuery) || c.name.toLowerCase().includes(state.searchQuery);

        if (matchCat && matchSearch) {
            unassignedList.appendChild(createCourseCard(c));
        }
    });
}

function updateProgress() {
    const dashboard = document.getElementById('progressDashboard');
    dashboard.innerHTML = '';

    // Calculate current planned units
    const plannedCourses = Object.keys(state.placements)
        .filter(code => state.placements[code] !== 'unassigned')
        .map(code => getCourseInfo(code))
        .filter(Boolean);

    REQUIREMENTS.forEach(req => {
        const filtered = plannedCourses.filter(req.filter);
        const sum = filtered.reduce((acc, crs) => acc + crs.units, 0);
        const percentage = Math.min(100, Math.round((sum / req.target) * 100));

        // For AI Minor COMP2701 substitution rule: this is a simple tracker, 
        // user just needs to hit 8 units overall among AI categorised + COMP2701.

        const widget = document.createElement('div');
        widget.className = 'progress-widget';
        widget.innerHTML = `
      <div class="progress-header">
        <span class="progress-title">${req.name}</span>
        <span class="progress-counts">
           <span style="color: ${sum >= req.target ? '#10b981' : 'var(--text-primary)'}">${sum}</span> / ${req.target} U
        </span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${percentage}%; background: ${req.color}"></div>
      </div>
    `;
        dashboard.appendChild(widget);
    });
}

// ---------------- Helpers & Logic ----------------

function getCourseInfo(code) {
    return state.courses.find(c => c.code === code);
}

function createCourseCard(c) {
    const el = document.createElement('div');
    el.className = 'course-card';
    el.draggable = true;
    el.id = 'card-' + c.code;
    el.dataset.code = c.code;
    el.style.setProperty('--bg-indicator', CAT_COLORS[c.cat] || '#ffffff');

    const excludesHtml = c.exclusiveWith
        ? `<div style="font-size: 0.75rem; color: #ef4444; margin-bottom: 0.25rem; font-weight: 500;">Excludes: ${c.exclusiveWith.join(', ')}</div>`
        : '';

    let semsHtml = '';
    if (state.loadingSemesters) {
        semsHtml = `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.75rem; font-style: italic;">Fetching semesters...</div>`;
    } else if (c.semesters && c.semesters.length > 0) {
        semsHtml = `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.75rem;">Sems: ${c.semesters.join(', ')}</div>`;
    } else {
        semsHtml = `<div style="font-size: 0.75rem; color: #ef4444; margin-bottom: 0.75rem;">Semesters Unknown</div>`;
    }

    el.innerHTML = `
    <div class="course-code">${c.code}</div>
    <div class="course-name">${c.name}</div>
    ${excludesHtml}
    ${semsHtml}
    <div class="course-meta">
      <span class="course-cat">${c.cat}</span>
      <span class="course-units">${c.units} U</span>
    </div>
  `;

    el.addEventListener('dragstart', handleDragStart);
    el.addEventListener('dragend', handleDragEnd);

    return el;
}

// ---------------- Drag and Drop ----------------

let draggedCardId = null;

function handleDragStart(e) {
    draggedCardId = this.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.code);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.semester-dropzone, #unassignedList').forEach(z => z.classList.remove('drag-over'));
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    // Don't add if it's not the main dropzone container
    if (this.classList.contains('semester-dropzone') || this.id === 'unassignedList') {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    if (this.classList.contains('semester-dropzone') || this.id === 'unassignedList') {
        this.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    e.stopPropagation();
    this.classList.remove('drag-over');

    const code = e.dataTransfer.getData('text/plain');
    if (!code) return;

    const targetId = this.dataset.semester || this.id;

    if (targetId !== 'unassignedList') {
        const courseInfo = getCourseInfo(code);

        // 1. Check Semesters
        const targetSem = SEMESTERS.find(s => s.id === targetId);
        if (courseInfo && targetSem && courseInfo.semesters) {
            if (!courseInfo.semesters.includes(targetSem.semNum)) {
                alert(`Cannot add ${code} to ${targetSem.name}. It is only available in Semester(s): ${courseInfo.semesters.join(', ')}.`);
                return; // Cancel drop
            }
        }

        // 2. Check Exclusivity
        if (courseInfo && courseInfo.exclusiveWith) {
            for (const excl of courseInfo.exclusiveWith) {
                if (state.placements[excl] && state.placements[excl] !== 'unassigned') {
                    if (!confirm(`${code} is mutually exclusive with ${excl}, which is already in your plan. Are you sure you want to add both?`)) {
                        return;
                    }
                }
            }
        }
    }

    // If moving back to catalog
    if (targetId === 'unassignedList') {
        state.placements[code] = 'unassigned';
    } else {
        // If moving to a semester
        const courseInfo = getCourseInfo(code);

        if (courseInfo && courseInfo.isYearLong) {
            // Find current semester index
            const currentSemIdx = SEMESTERS.findIndex(s => s.id === targetId);

            // Year long course needs a subsequent semester
            if (currentSemIdx + 1 < SEMESTERS.length) {
                const nextSemId = SEMESTERS[currentSemIdx + 1].id;
                state.placements[code] = [targetId, nextSemId];
            } else {
                alert(`Cannot place ${code} here. As a year-long course, it requires a subsequent semester to complete Part 2.`);
                return;
            }
        } else {
            state.placements[code] = targetId;
        }
    }

    saveState();
    renderSemesters();
    renderCatalog();
    updateProgress();
}
