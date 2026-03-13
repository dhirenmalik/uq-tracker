const UQ_PLANNER_PROXY = 'https://lingering-bush-c27d.late-night.workers.dev/?/subjects';
const semesterCache = {};

async function ensureCourseSemesters(code) {
    if (semesterCache[code]) return semesterCache[code];

    const year = new Date().getFullYear();
    const sems = new Set();

    // Query both current and previous year and merge results.
    // Current year may only have S1 data published (e.g. early in the year),
    // so we also check last year to catch S2 offerings.
    for (const y of [year, year - 1]) {
        try {
            const body = `search-term=${code}&semester=ALL&campus=ALL&faculty=ALL&type=ALL&days=1&days=2&days=3&days=4&days=5&days=6&days=0&start-time=00%3A00&end-time=23%3A00`;
            const res = await fetch(UQ_PLANNER_PROXY, {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'year': y.toString()
                },
                body
            });
            const data = await res.json();
            for (const key in data) {
                if (key.toUpperCase().startsWith(code)) {
                    if (data[key].semester === 'S1') sems.add(1);
                    if (data[key].semester === 'S2') sems.add(2);
                }
            }
        } catch (e) {
        }
    }

    const arr = Array.from(sems).sort();
    semesterCache[code] = arr;
    return arr;
}

let currentDegreeId = localStorage.getItem('uq_tracker_degree') || 'se_ai';
let COURSES = DEGREES[currentDegreeId].courses;
let REQUIREMENTS = DEGREES[currentDegreeId].requirements;
let SEMESTERS = DEGREES[currentDegreeId].semesters;

let state = {
    courses: [...COURSES],
    placements: {},
    activeFilter: 'All',
    searchQuery: '',
    loadingSemesters: false
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    const degreeSelect = document.getElementById('degreeSelect');
    if (degreeSelect) {
        degreeSelect.value = currentDegreeId;
        degreeSelect.addEventListener('change', e => {
            if (confirm("Changing degree will switch your plan. Continue?")) {
                changeDegree(e.target.value);
            } else {
                e.target.value = currentDegreeId;
            }
        });
    }

    loadState();
    renderFilters();
    renderSemesters();
    renderCatalog();
    updateProgress();

    document.getElementById('courseSearch').addEventListener('input', e => {
        state.searchQuery = e.target.value.toLowerCase();
        renderCatalog();
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

    const unassignedList = document.getElementById('unassignedList');
    unassignedList.addEventListener('dragover', handleDragOver);
    unassignedList.addEventListener('drop', handleDrop);
    unassignedList.addEventListener('dragenter', handleDragEnter);
    unassignedList.addEventListener('dragleave', handleDragLeave);
}

function changeDegree(newDegreeId) {
    localStorage.setItem('uq_tracker_degree', newDegreeId);
    currentDegreeId = newDegreeId;
    COURSES = DEGREES[currentDegreeId].courses;
    REQUIREMENTS = DEGREES[currentDegreeId].requirements;
    SEMESTERS = DEGREES[currentDegreeId].semesters;

    state.courses = [...COURSES];
    state.placements = {};
    state.activeFilter = 'All';
    state.searchQuery = '';
    state.loadingSemesters = true;

    loadState();
    renderFilters();
    renderSemesters();
    renderCatalog();
    updateProgress();
}

function renderFilters() {
    const container = document.getElementById('catFilters');
    container.innerHTML = '<button class="filter-pill active" data-cat="All">All</button>';

    const cats = [...new Set(state.courses.map(c => c.cat))];
    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        btn.dataset.cat = cat;
        btn.innerText = cat;
        container.appendChild(btn);
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
}

function loadState() {
    const saved = localStorage.getItem(`uq_tracker_state_${currentDegreeId}`);
    if (saved) {
        try {
            state.placements = JSON.parse(saved);
        } catch (e) {
        }
    } else {
        state.placements = {};
    }
}

function saveState() {
    localStorage.setItem(`uq_tracker_state_${currentDegreeId}`, JSON.stringify(state.placements));
}

function renderSemesters() {
    const grid = document.getElementById('semestersGrid');
    grid.innerHTML = '';

    SEMESTERS.forEach(sem => {
        const box = document.createElement('div');
        box.className = 'semester-box';

        const header = document.createElement('div');
        header.className = 'semester-header';
        header.innerHTML = `
      <div class="semester-title">${sem.name}</div>
      <div class="semester-units" id="units-${sem.id}">0 / 8 units</div>
    `;

        const dropzone = document.createElement('div');
        dropzone.className = 'semester-dropzone';
        dropzone.id = sem.id;
        dropzone.dataset.semester = sem.id;

        dropzone.addEventListener('dragover', handleDragOver);
        dropzone.addEventListener('drop', handleDrop);
        dropzone.addEventListener('dragenter', handleDragEnter);
        dropzone.addEventListener('dragleave', handleDragLeave);

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
                const semUnits = cInfo.isYearLong ? (cInfo.units / 2) : cInfo.units;
                units += semUnits;

                const card = createCourseCard(cInfo);

                if (cInfo.isYearLong && Array.isArray(state.placements[code])) {
                    if (state.placements[code][1] === sem.id) {
                        card.querySelector('.course-name').innerHTML += ' <span style="color: var(--accent-color); font-weight: bold;">(Part 2)</span>';
                        card.draggable = false;
                        card.style.opacity = '0.7';
                        card.style.cursor = 'default';
                        card.removeEventListener('dragstart', handleDragStart);
                        card.removeEventListener('dragend', handleDragEnd);
                    }
                }

                card.querySelector('.course-units').innerText = `${semUnits} U`;

                dropzone.appendChild(card);
            }
        });

        header.querySelector('.semester-units').innerText = `${units} / 8 units`;
        if (units > 8) header.querySelector('.semester-units').style.color = '#ef4444';

        box.appendChild(header);
        box.appendChild(dropzone);
        grid.appendChild(box);
    });
}

function renderCatalog() {
    const unassignedList = document.getElementById('unassignedList');
    unassignedList.innerHTML = '';

    state.courses.forEach(c => {
        if (state.placements[c.code] && state.placements[c.code] !== 'unassigned') return;

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

    const plannedCourses = Object.keys(state.placements)
        .filter(code => state.placements[code] !== 'unassigned')
        .map(code => getCourseInfo(code))
        .filter(Boolean);

    REQUIREMENTS.forEach(req => {
        const filtered = plannedCourses.filter(req.filter);
        const sum = filtered.reduce((acc, crs) => acc + crs.units, 0);
        const percentage = Math.min(100, Math.round((sum / req.target) * 100));

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

    let semsHtml = `<div class="sem-info" style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.75rem;">Loading semesters...</div>`;

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

    if (c.semesters) {
        updateCardSems(el, c.semesters);
    } else {
        ensureCourseSemesters(c.code).then(sems => {
            c.semesters = sems;
            updateCardSems(el, sems);
        });
    }

    return el;
}

function updateCardSems(el, sems) {
    const infoEl = el.querySelector('.sem-info');
    if (!infoEl) return;
    if (sems && sems.length > 0) {
        infoEl.innerText = `Sems: ${sems.join(', ')}`;
        infoEl.style.color = 'var(--text-secondary)';
    } else {
        infoEl.innerText = 'Semesters Unknown';
        infoEl.style.color = '#ef4444';
    }
}

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

        const targetSem = SEMESTERS.find(s => s.id === targetId);
        if (courseInfo && targetSem) {
            if (!courseInfo.semesters) {
                // Semester data hasn't loaded from API yet — block placement
                alert(`Semester availability for ${code} is still loading. Please wait a moment and try again.`);
                return;
            }
            if (courseInfo.semesters.length > 0 && !courseInfo.semesters.includes(targetSem.semNum)) {
                const semNames = courseInfo.semesters.map(s => `Semester ${s}`).join(', ');
                alert(`Cannot add ${code} to ${targetSem.name}. It is only available in: ${semNames}.`);
                return;
            }
        }

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

    if (targetId === 'unassignedList') {
        state.placements[code] = 'unassigned';
    } else {
        const courseInfo = getCourseInfo(code);

        if (courseInfo && courseInfo.isYearLong) {
            const currentSemIdx = SEMESTERS.findIndex(s => s.id === targetId);

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