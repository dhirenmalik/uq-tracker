// ============================================================
// API
// ============================================================

const UQ_PLANNER_PROXY = 'https://lingering-bush-c27d.late-night.workers.dev/?/subjects';
const semesterCache = {};

async function ensureCourseSemesters(code) {
    if (semesterCache[code]) return semesterCache[code];

    // Get all unique years from the degree's semester definitions
    const years = [...new Set(SEMESTERS.map(s => s.year))].sort();
    const result = {}; // { year: [1], year: [1, 2], ... }

    // Query each year in parallel
    const fetches = years.map(async (y) => {
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
            const sems = new Set();
            for (const key in data) {
                if (key.toUpperCase().startsWith(code)) {
                    if (data[key].semester === 'S1') sems.add(1);
                    if (data[key].semester === 'S2') sems.add(2);
                }
            }
            if (sems.size > 0) {
                result[y] = Array.from(sems).sort();
            }
        } catch (e) {
        }
    });
    await Promise.all(fetches);

    // For years with no API data (e.g. future years), prefer 2025 data
    // as the most reliable reference, then fall back to nearest earlier year.
    // If no data exists at all, leave unset so the course is placeable anywhere.
    for (const y of years) {
        if (!result[y]) {
            if (result[2025]) {
                result[y] = [...result[2025]];
            } else {
                for (let prev = y - 1; prev >= years[0]; prev--) {
                    if (result[prev]) {
                        result[y] = [...result[prev]];
                        break;
                    }
                }
            }
        }
    }

    semesterCache[code] = result;
    return result;
}

// ============================================================
// STATE
// ============================================================

let currentDegreeId = localStorage.getItem('uq_tracker_degree');
if (!currentDegreeId || !DEGREES[currentDegreeId]) currentDegreeId = 'se_ai';
let COURSES = DEGREES[currentDegreeId].courses;
let REQUIREMENTS = DEGREES[currentDegreeId].requirements;
let SEMESTERS = DEGREES[currentDegreeId].semesters;

let state = {
    courses: [...COURSES],
    placements: {},
    activeFilter: 'All',
    searchQuery: ''
};

const HISTORY_LIMIT = 50;
const THEME_STORAGE_KEY = 'uq_tracker_theme';
let history = [];
let historyIndex = -1;
let shareToastTimer = null;
const dom = {};

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    applyInitialTheme();

    dom.degreeSelect = document.getElementById('degreeSelect');
    dom.courseSearch = document.getElementById('courseSearch');
    dom.resetBtn = document.getElementById('resetBtn');
    dom.undoBtn = document.getElementById('undoBtn');
    dom.redoBtn = document.getElementById('redoBtn');
    dom.shareBtn = document.getElementById('shareBtn');
    dom.themeToggleBtn = document.getElementById('themeToggleBtn');
    dom.unassignedList = document.getElementById('unassignedList');
    dom.semestersGrid = document.getElementById('semestersGrid');
    dom.progressDashboard = document.getElementById('progressDashboard');
    dom.loadingBar = document.getElementById('loadingBar');
    dom.loadingBarFill = document.getElementById('loadingBarFill');
    dom.loadingBarText = document.getElementById('loadingBarText');

    if (dom.degreeSelect) {
        dom.degreeSelect.value = currentDegreeId;
        dom.degreeSelect.addEventListener('change', e => {
            if (confirm("Changing degree will switch your plan. Continue?")) {
                changeDegree(e.target.value);
            } else {
                e.target.value = currentDegreeId;
            }
        });
    }

    loadState();
    initializeHistory();
    renderFilters();
    renderAll();
    updateHistoryControls();
    updateThemeToggleLabel();

    dom.courseSearch.addEventListener('input', e => {
        state.searchQuery = e.target.value.toLowerCase();
        renderCatalog();
    });

    dom.resetBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to reset your plan?")) {
            state.placements = {};
            saveState();
            renderAll();
        }
    });

    if (dom.undoBtn) dom.undoBtn.addEventListener('click', undo);
    if (dom.redoBtn) dom.redoBtn.addEventListener('click', redo);
    if (dom.shareBtn) dom.shareBtn.addEventListener('click', sharePlan);
    if (dom.themeToggleBtn) {
        dom.themeToggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            setTheme(current === 'dark' ? 'light' : 'dark', true);
        });
    }

    document.addEventListener('keydown', handleHistoryShortcuts);

    dom.unassignedList.addEventListener('dragover', handleDragOver);
    dom.unassignedList.addEventListener('drop', handleDrop);
    dom.unassignedList.addEventListener('dragenter', handleDragEnter);
    dom.unassignedList.addEventListener('dragleave', handleDragLeave);

    const realCodes = state.courses
        .filter(c => /^[A-Z]{4}\d{4}$/.test(c.code))
        .map(c => c.code);
    const total = realCodes.length;

    if (total > 0) {
        let completed = 0;

        const promises = realCodes.map(code =>
            ensureCourseSemesters(code).then(sems => {
                const cInfo = state.courses.find(c => c.code === code);
                if (cInfo) cInfo.semesters = sems;
                completed++;
                const pct = Math.round((completed / total) * 100);
                if (dom.loadingBarFill) dom.loadingBarFill.style.width = pct + '%';
                if (dom.loadingBarText) dom.loadingBarText.textContent = `LOADING SEMESTERS ${completed}/${total}`;
            })
        );

        await Promise.all(promises);

        if (dom.loadingBar) dom.loadingBar.classList.add('hidden');

        renderSemesters();
        renderCatalog();
    } else {
        if (dom.loadingBar) dom.loadingBar.classList.add('hidden');
    }
}

// ============================================================
// DEGREE
// ============================================================

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
    loadState();
    initializeHistory();
    renderFilters();
    renderAll();
    updateHistoryControls();
}

// ============================================================
// FILTERS
// ============================================================

function renderFilters() {
    const container = document.getElementById('catFilters');
    container.innerHTML = '<button class="filter-pill active" data-cat="All">All</button>';

    const cats = [...new Set(state.courses.map(c => c.cat))];
    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        btn.dataset.cat = cat;
        btn.textContent = cat;
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

// ============================================================
// PERSISTENCE
// ============================================================

function loadState() {
    let loadedFromHash = false;

    if (window.location.hash && window.location.hash.length > 1) {
        const hashState = decodeStateFromHash(window.location.hash.slice(1));
        if (hashState && hashState.degreeId && DEGREES[hashState.degreeId]) {
            if (hashState.degreeId !== currentDegreeId) {
                currentDegreeId = hashState.degreeId;
                localStorage.setItem('uq_tracker_degree', currentDegreeId);
                COURSES = DEGREES[currentDegreeId].courses;
                REQUIREMENTS = DEGREES[currentDegreeId].requirements;
                SEMESTERS = DEGREES[currentDegreeId].semesters;
                state.courses = [...COURSES];
            }
            state.placements = (hashState.placements && typeof hashState.placements === 'object') ? hashState.placements : {};
            saveState();
            loadedFromHash = true;
        }
    }

    if (loadedFromHash) {
        return;
    }

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
    pushHistorySnapshot();
    updateHistoryControls();
}

// ============================================================
// HISTORY
// ============================================================

function clonePlacements() {
    return JSON.parse(JSON.stringify(state.placements || {}));
}

function placementsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function initializeHistory() {
    history = [clonePlacements()];
    historyIndex = 0;
}

function pushHistorySnapshot() {
    const snapshot = clonePlacements();
    const current = history[historyIndex];
    if (current && placementsEqual(current, snapshot)) return;

    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }

    history.push(snapshot);
    if (history.length > HISTORY_LIMIT) {
        history.shift();
    } else {
        historyIndex += 1;
    }

    if (history.length === HISTORY_LIMIT && historyIndex >= HISTORY_LIMIT) {
        historyIndex = HISTORY_LIMIT - 1;
    }
}

function restoreHistorySnapshot(snapshot) {
    state.placements = JSON.parse(JSON.stringify(snapshot || {}));
    localStorage.setItem(`uq_tracker_state_${currentDegreeId}`, JSON.stringify(state.placements));
    renderAll();
    updateHistoryControls();
}

function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreHistorySnapshot(history[historyIndex]);
}

function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    restoreHistorySnapshot(history[historyIndex]);
}

function updateHistoryControls() {
    if (dom.undoBtn) dom.undoBtn.disabled = historyIndex <= 0;
    if (dom.redoBtn) dom.redoBtn.disabled = historyIndex >= history.length - 1;
}

function handleHistoryShortcuts(e) {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) {
        return;
    }

    const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
    const isRedo = (e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y');

    if (isUndo) {
        e.preventDefault();
        undo();
        return;
    }

    if (isRedo) {
        e.preventDefault();
        redo();
    }
}

// ============================================================
// SHARE
// ============================================================

function encodeStateForHash() {
    const payload = {
        degreeId: currentDegreeId,
        placements: state.placements
    };
    return btoa(encodeURIComponent(JSON.stringify(payload)));
}

function decodeStateFromHash(hashValue) {
    try {
        const json = decodeURIComponent(atob(hashValue));
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

async function sharePlan() {
    const hash = encodeStateForHash();
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    window.location.hash = hash;

    try {
        await navigator.clipboard.writeText(url);
        showShareToast('Link copied!');
    } catch (e) {
        showShareToast('Link ready in URL bar');
    }
}

function showShareToast(message) {
    let toast = document.getElementById('shareToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'shareToast';
        toast.className = 'share-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;

    if (shareToastTimer) clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(() => {
        if (toast && toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
        shareToastTimer = null;
    }, 2000);
}

// ============================================================
// THEME
// ============================================================

function detectInitialTheme() {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme);
    updateThemeToggleLabel();
}

function applyInitialTheme() {
    const initial = detectInitialTheme();
    setTheme(initial, false);
}

function updateThemeToggleLabel() {
    if (!dom.themeToggleBtn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    dom.themeToggleBtn.textContent = isDark ? 'LIGHT' : 'DARK';
}

// ============================================================
// RENDERING
// ============================================================

function renderSemesters() {
    dom.semestersGrid.innerHTML = '';

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

                card.querySelector('.course-units').textContent = `${semUnits} U`;

                dropzone.appendChild(card);
            }
        });

        header.querySelector('.semester-units').textContent = `${units} / 8 units`;
        if (units > 8) header.querySelector('.semester-units').style.color = '#ef4444';

        box.appendChild(header);
        box.appendChild(dropzone);
        dom.semestersGrid.appendChild(box);
    });
}

function renderCatalog() {
    dom.unassignedList.innerHTML = '';

    state.courses.forEach(c => {
        if (state.placements[c.code] && state.placements[c.code] !== 'unassigned') return;

        const matchCat = state.activeFilter === 'All' || c.cat === state.activeFilter;
        const matchSearch = c.code.toLowerCase().includes(state.searchQuery) || c.name.toLowerCase().includes(state.searchQuery);

        if (matchCat && matchSearch) {
            dom.unassignedList.appendChild(createCourseCard(c));
        }
    });
}

function updateProgress() {
    dom.progressDashboard.innerHTML = '';

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
        dom.progressDashboard.appendChild(widget);
    });
}

function getCourseInfo(code) {
    return state.courses.find(c => c.code === code);
}

function renderAll() {
    renderSemesters();
    renderCatalog();
    updateProgress();
}

// ============================================================
// CARDS
// ============================================================

function createCourseCard(c) {
    const el = document.createElement('div');
    el.className = 'course-card';
    el.draggable = true;
    el.id = 'card-' + c.code;
    el.dataset.code = c.code;
    el.style.setProperty('--bg-indicator', CAT_COLORS[c.cat] || '#ffffff');

    const excludesHtml = c.exclusiveWith
        ? `<div class="course-excludes">Excludes: ${c.exclusiveWith.join(', ')}</div>`
        : '';

    const semsHtml = `<div class="sem-info">Loading semesters...</div>`;

    const isRealCourse = /^[A-Z]{4}\d{4}$/.test(c.code);
    const linkHtml = isRealCourse
        ? `<a class="course-link" href="https://programs-courses.uq.edu.au/course.html?course_code=${c.code}" target="_blank" draggable="false">UQ&nbsp;PAGE&nbsp;&rarr;</a>`
        : '';

    el.innerHTML = `
    <div class="course-code">${c.code}${linkHtml}</div>
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

    const code = el.dataset.code;
    const placement = code ? state.placements[code] : null;
    const isPlaced = !!placement && placement !== 'unassigned';

    infoEl.className = 'sem-info';

    if (sems && typeof sems === 'object') {
        const years = Object.keys(sems).sort();

        if (isPlaced) {
            const yearly = years
                .filter(y => Array.isArray(sems[y]) && sems[y].length > 0)
                .map(y => `${String(y).slice(-2)}: ${sems[y].map(s => 'S' + s).join(',')}`)
                .join(' | ');

            if (yearly) {
                infoEl.textContent = yearly;
                infoEl.classList.add('sem-info--placed');
                return;
            }
        }

        const allSems = new Set();
        for (const y of years) {
            if (sems[y]) sems[y].forEach(s => allSems.add(s));
        }

        if (allSems.size > 0) {
            const sorted = Array.from(allSems).sort();
            infoEl.textContent = `Offered: ${sorted.map(s => 'S' + s).join(', ')}`;
            return;
        }
    }

    infoEl.textContent = 'Semesters Unknown';
    infoEl.classList.add('sem-info--unknown');
}

// ============================================================
// DRAG & DROP
// ============================================================

let draggedCardId = null;

function handleDragStart(e) {
    draggedCardId = this.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.code);
}

function handleDragEnd() {
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

function handleDragLeave() {
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

    const courseInfo = getCourseInfo(code);

    if (targetId !== 'unassignedList') {

        const targetSem = SEMESTERS.find(s => s.id === targetId);
        if (courseInfo && targetSem) {
            if (!courseInfo.semesters) {
                // Semester data hasn't loaded from API yet — block placement
                alert(`Semester availability for ${code} is still loading. Please wait a moment and try again.`);
                return;
            }
            // Crosscheck against the specific year the user is placing into
            const yearData = courseInfo.semesters[targetSem.year];
            if (yearData && yearData.length > 0 && !yearData.includes(targetSem.semNum)) {
                alert(`Cannot add ${code} to ${targetSem.name}. In ${targetSem.year}, it is only available in: ${yearData.map(s => 'S' + s).join(', ')}.`);
                return;
            }
        }

        if (courseInfo && Array.isArray(courseInfo.prereqs) && courseInfo.prereqs.length > 0 && targetSem) {
            const targetSemIndex = SEMESTERS.findIndex(s => s.id === targetId);
            for (const prereqCode of courseInfo.prereqs) {
                const prereqPlacement = state.placements[prereqCode];
                let prereqSemId = null;

                if (Array.isArray(prereqPlacement)) {
                    prereqSemId = prereqPlacement[0] || null;
                } else if (typeof prereqPlacement === 'string' && prereqPlacement !== 'unassigned') {
                    prereqSemId = prereqPlacement;
                }

                const prereqSemIndex = prereqSemId ? SEMESTERS.findIndex(s => s.id === prereqSemId) : -1;
                const prereqSatisfied = prereqSemIndex >= 0 && prereqSemIndex < targetSemIndex;

                if (!prereqSatisfied) {
                    if (!confirm(`${code} has prerequisite ${prereqCode} which is not completed before ${targetSem.name}. Place anyway?`)) {
                        return;
                    }
                }
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
    renderAll();
}
