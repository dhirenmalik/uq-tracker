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
    semesterOrder: {},
    activeFilter: 'All',
    searchQuery: ''
};

const HISTORY_LIMIT = 50;
const THEME_STORAGE_KEY = 'uq_tracker_theme';
let history = [];
let historyIndex = -1;
let shareToastTimer = null;
let dropIndicatorCard = null;
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
    dom.exportBtn = document.getElementById('exportBtn');
    dom.themeToggleBtn = document.getElementById('themeToggleBtn');
    dom.unassignedList = document.getElementById('unassignedList');
    dom.semestersGrid = document.getElementById('semestersGrid');
    dom.progressDashboard = document.getElementById('progressDashboard');
    dom.loadingBar = document.getElementById('loadingBar');
    dom.loadingBarFill = document.getElementById('loadingBarFill');
    dom.loadingBarText = document.getElementById('loadingBarText');
    dom.addElectiveToggleBtn = document.getElementById('addElectiveToggleBtn');
    dom.addElectiveForm = document.getElementById('addElectiveForm');
    dom.customCodeInput = document.getElementById('customCourseCode');
    dom.customNameInput = document.getElementById('customCourseName');
    dom.customUnitsInput = document.getElementById('customCourseUnits');
    dom.cancelElectiveBtn = document.getElementById('cancelElectiveBtn');

    loadCustomCoursesForCurrentDegree();

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
            state.semesterOrder = {};
            saveState();
            renderAll();
        }
    });

    if (dom.undoBtn) dom.undoBtn.addEventListener('click', undo);
    if (dom.redoBtn) dom.redoBtn.addEventListener('click', redo);
    if (dom.shareBtn) dom.shareBtn.addEventListener('click', sharePlan);
    if (dom.exportBtn) dom.exportBtn.addEventListener('click', exportPlan);
    if (dom.themeToggleBtn) {
        dom.themeToggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            setTheme(current === 'dark' ? 'light' : 'dark', true);
        });
    }

    if (dom.addElectiveToggleBtn) {
        dom.addElectiveToggleBtn.addEventListener('click', showCustomElectiveForm);
    }
    if (dom.cancelElectiveBtn) {
        dom.cancelElectiveBtn.addEventListener('click', hideCustomElectiveForm);
    }
    if (dom.addElectiveForm) {
        dom.addElectiveForm.addEventListener('submit', handleCustomElectiveSubmit);
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
    loadCustomCoursesForCurrentDegree();
    state.placements = {};
    state.semesterOrder = {};
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
    const allActive = state.activeFilter === 'All' ? ' active' : '';
    container.innerHTML = `<button class="filter-pill${allActive}" data-cat="All">All</button>`;

    const cats = [...new Set(state.courses.map(c => c.cat))];
    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `filter-pill${state.activeFilter === cat ? ' active' : ''}`;
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
                loadCustomCoursesForCurrentDegree();
            }
            state.placements = (hashState.placements && typeof hashState.placements === 'object') ? hashState.placements : {};
            state.semesterOrder = (hashState.semesterOrder && typeof hashState.semesterOrder === 'object') ? hashState.semesterOrder : {};
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
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object' && parsed.placements) {
                state.placements = parsed.placements;
                state.semesterOrder = (parsed.semesterOrder && typeof parsed.semesterOrder === 'object') ? parsed.semesterOrder : {};
            } else {
                state.placements = parsed;
                state.semesterOrder = {};
            }
        } catch (e) {
        }
    } else {
        state.placements = {};
        state.semesterOrder = {};
    }
}

function saveState() {
    localStorage.setItem(`uq_tracker_state_${currentDegreeId}`, JSON.stringify({
        placements: state.placements,
        semesterOrder: state.semesterOrder
    }));
    pushHistorySnapshot();
    updateHistoryControls();
}

// ============================================================
// HISTORY
// ============================================================

function clonePlacements() {
    return JSON.parse(JSON.stringify({
        placements: state.placements || {},
        semesterOrder: state.semesterOrder || {}
    }));
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
    const safeSnapshot = snapshot || {};
    state.placements = JSON.parse(JSON.stringify(safeSnapshot.placements || {}));
    state.semesterOrder = JSON.parse(JSON.stringify(safeSnapshot.semesterOrder || {}));
    localStorage.setItem(`uq_tracker_state_${currentDegreeId}`, JSON.stringify({
        placements: state.placements,
        semesterOrder: state.semesterOrder
    }));
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
        placements: state.placements,
        semesterOrder: state.semesterOrder
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

async function exportPlan() {
    if (typeof html2canvas !== 'function' || !dom.semestersGrid) {
        showShareToast('Export unavailable');
        return;
    }

    try {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }

        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim() || '#ffffff';
        const canvas = await html2canvas(dom.semestersGrid, {
            scale: 2,
            backgroundColor: bgColor,
            useCORS: true,
            logging: false
        });

        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/png');
        });

        if (!blob) {
            showShareToast('Export failed');
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `degree-plan-${timestamp}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showShareToast('Plan exported');
    } catch (e) {
        showShareToast('Export failed');
    }
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

        const existingOrder = Array.isArray(state.semesterOrder[sem.id]) ? state.semesterOrder[sem.id] : [];
        const orderedPlacedCodes = existingOrder.filter(code => placedCodes.includes(code));
        placedCodes.forEach(code => {
            if (!orderedPlacedCodes.includes(code)) {
                orderedPlacedCodes.push(code);
            }
        });
        state.semesterOrder[sem.id] = orderedPlacedCodes;

        let units = 0;

        orderedPlacedCodes.forEach(code => {
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
            const card = createCourseCard(c);
            if (state.searchQuery) {
                const codeEl = card.querySelector('.course-code-text');
                const nameEl = card.querySelector('.course-name');
                if (codeEl) codeEl.innerHTML = highlightSearchText(c.code, state.searchQuery);
                if (nameEl) nameEl.innerHTML = highlightSearchText(c.name, state.searchQuery);
            }
            dom.unassignedList.appendChild(card);
        }
    });
}

function highlightSearchText(text, query) {
    if (!query) return text;
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeQuery})`, 'ig');
    return String(text).replace(regex, '<mark class="search-highlight">$1</mark>');
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

    const deleteCustomHtml = c.isCustom
        ? '<button class="custom-course-delete" type="button" draggable="false" aria-label="Delete custom elective">×</button>'
        : '';

    el.innerHTML = `
    <div class="course-code">
      <span class="course-code-text">${c.code}</span>
      <span class="course-code-actions">${linkHtml}${deleteCustomHtml}</span>
    </div>
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
    el.addEventListener('mouseenter', handleCourseHoverEnter);
    el.addEventListener('mouseleave', clearCourseHoverHighlights);

    const deleteBtn = el.querySelector('.custom-course-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeCustomCourse(c.code);
        });
    }

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

function handleCourseHoverEnter() {
    clearCourseHoverHighlights();

    const code = this.dataset.code;
    if (!code) return;

    const info = getCourseInfo(code);
    if (!info) return;

    const prereqSet = new Set(Array.isArray(info.prereqs) ? info.prereqs : []);
    const dependentSet = new Set(
        state.courses
            .filter(course => Array.isArray(course.prereqs) && course.prereqs.includes(code))
            .map(course => course.code)
    );

    document.querySelectorAll('.course-card').forEach(card => {
        const cardCode = card.dataset.code;
        if (!cardCode) return;
        if (prereqSet.has(cardCode)) card.classList.add('prereq-highlight');
        if (dependentSet.has(cardCode)) card.classList.add('dependent-highlight');
    });

    this.classList.add('prereq-glow');
}

function clearCourseHoverHighlights() {
    document.querySelectorAll('.course-card').forEach(card => {
        card.classList.remove('prereq-highlight');
        card.classList.remove('dependent-highlight');
        card.classList.remove('prereq-glow');
    });
}

function getCustomCoursesStorageKey() {
    return `uq_tracker_custom_courses_${currentDegreeId}`;
}

function loadCustomCoursesForCurrentDegree() {
    const saved = localStorage.getItem(getCustomCoursesStorageKey());
    if (!saved) return;

    try {
        const customCourses = JSON.parse(saved);
        if (!Array.isArray(customCourses)) return;
        const existing = new Set(state.courses.map(course => course.code));
        customCourses.forEach(course => {
            if (course && course.code && !existing.has(course.code)) {
                state.courses.push(course);
                existing.add(course.code);
            }
        });
    } catch (e) {
    }
}

function saveCustomCoursesForCurrentDegree() {
    const customCourses = state.courses.filter(course => course.isCustom === true);
    localStorage.setItem(getCustomCoursesStorageKey(), JSON.stringify(customCourses));
}

function showCustomElectiveForm() {
    if (!dom.addElectiveForm) return;
    dom.addElectiveForm.classList.remove('is-hidden');
    if (dom.customCodeInput) dom.customCodeInput.focus();
}

function hideCustomElectiveForm() {
    if (!dom.addElectiveForm) return;
    dom.addElectiveForm.classList.add('is-hidden');
    dom.addElectiveForm.reset();
}

function handleCustomElectiveSubmit(e) {
    e.preventDefault();

    const rawCode = dom.customCodeInput ? dom.customCodeInput.value.trim() : '';
    const rawName = dom.customNameInput ? dom.customNameInput.value.trim() : '';
    const rawUnits = dom.customUnitsInput ? dom.customUnitsInput.value : '2';

    const code = rawCode.toUpperCase();
    const name = rawName;
    const units = parseInt(rawUnits, 10);

    if (!code || !name) {
        alert('Please provide both code and name.');
        return;
    }

    const exists = state.courses.some(course => course.code === code);
    if (exists) {
        alert(`Course ${code} already exists.`);
        return;
    }

    state.courses.push({
        code,
        name,
        units,
        cat: 'Elective',
        isCustom: true
    });

    saveCustomCoursesForCurrentDegree();
    renderFilters();
    renderCatalog();
    hideCustomElectiveForm();
}

function removeCustomCourse(code) {
    state.courses = state.courses.filter(course => course.code !== code);
    delete state.placements[code];
    removeCourseFromSemesterOrder(code);
    saveCustomCoursesForCurrentDegree();
    saveState();
    renderFilters();
    renderAll();
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
    clearDropIndicator();
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!this.classList.contains('semester-dropzone')) {
        clearDropIndicator();
        return;
    }

    const beforeCard = getDropIndicatorCard(this, e.clientY);
    if (dropIndicatorCard && dropIndicatorCard !== beforeCard) {
        dropIndicatorCard.classList.remove('drop-indicator');
    }
    dropIndicatorCard = beforeCard;
    if (dropIndicatorCard) {
        dropIndicatorCard.classList.add('drop-indicator');
    }
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

    if (this.classList.contains('semester-dropzone')) {
        clearDropIndicator();
    }
}

function handleDrop(e) {
    e.stopPropagation();
    this.classList.remove('drag-over');

    const code = e.dataTransfer.getData('text/plain');
    if (!code) return;

    const targetId = this.dataset.semester || this.id;
    const targetSemesterId = targetId === 'unassignedList' ? null : targetId;
    const beforeCard = this.classList.contains('semester-dropzone') ? getDropIndicatorCard(this, e.clientY) : null;
    const beforeCode = beforeCard ? beforeCard.dataset.code : null;

    const courseInfo = getCourseInfo(code);
    const previousPlacement = state.placements[code];
    const sourceSemId = Array.isArray(previousPlacement)
        ? (previousPlacement[0] || null)
        : ((typeof previousPlacement === 'string' && previousPlacement !== 'unassigned') ? previousPlacement : null);

    if (targetSemesterId && sourceSemId === targetSemesterId) {
        const draggedEl = draggedCardId ? document.getElementById(draggedCardId) : null;
        if (draggedEl && this.classList.contains('semester-dropzone')) {
            if (beforeCard && beforeCard !== draggedEl) {
                this.insertBefore(draggedEl, beforeCard);
            } else if (!beforeCard) {
                this.appendChild(draggedEl);
            }
        }
        reorderCourseInSemester(targetSemesterId, code, beforeCode);
        saveState();
        renderAll();
        clearDropIndicator();
        return;
    }

    if (targetId !== 'unassignedList') {

        const targetSem = SEMESTERS.find(s => s.id === targetId);
        if (courseInfo && targetSem) {
            if (!courseInfo.semesters) {
                // Semester data hasn't loaded from API yet — block placement
                alert(`Semester availability for ${code} is still loading. Please wait a moment and try again.`);
                clearDropIndicator();
                return;
            }
            // Crosscheck against the specific year the user is placing into
            const yearData = courseInfo.semesters[targetSem.year];
            if (yearData && yearData.length > 0 && !yearData.includes(targetSem.semNum)) {
                alert(`Cannot add ${code} to ${targetSem.name}. In ${targetSem.year}, it is only available in: ${yearData.map(s => 'S' + s).join(', ')}.`);
                clearDropIndicator();
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
                        clearDropIndicator();
                        return;
                    }
                }
            }
        }

        if (courseInfo && courseInfo.exclusiveWith) {
            for (const excl of courseInfo.exclusiveWith) {
                if (state.placements[excl] && state.placements[excl] !== 'unassigned') {
                    if (!confirm(`${code} is mutually exclusive with ${excl}, which is already in your plan. Are you sure you want to add both?`)) {
                        clearDropIndicator();
                        return;
                    }
                }
            }
        }
    }

    if (targetId === 'unassignedList') {
        state.placements[code] = 'unassigned';
        removeCourseFromSemesterOrder(code);
    } else {
        removeCourseFromSemesterOrder(code);

        if (courseInfo && courseInfo.isYearLong) {
            const currentSemIdx = SEMESTERS.findIndex(s => s.id === targetId);

            if (currentSemIdx + 1 < SEMESTERS.length) {
                const nextSemId = SEMESTERS[currentSemIdx + 1].id;
                state.placements[code] = [targetId, nextSemId];
                insertCourseInSemesterOrder(targetId, code, beforeCode);
                insertCourseInSemesterOrder(nextSemId, code, null);
            } else {
                alert(`Cannot place ${code} here. As a year-long course, it requires a subsequent semester to complete Part 2.`);
                clearDropIndicator();
                return;
            }
        } else {
            state.placements[code] = targetId;
            insertCourseInSemesterOrder(targetId, code, beforeCode);
        }
    }

    saveState();
    renderAll();
    clearDropIndicator();
}

function getDropIndicatorCard(dropzone, clientY) {
    const cards = [...dropzone.querySelectorAll('.course-card:not(.dragging)')];
    for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (clientY < midpoint) return card;
    }
    return null;
}

function clearDropIndicator() {
    if (dropIndicatorCard) {
        dropIndicatorCard.classList.remove('drop-indicator');
        dropIndicatorCard = null;
    }
}

function removeCourseFromSemesterOrder(code) {
    Object.keys(state.semesterOrder).forEach(semId => {
        const order = Array.isArray(state.semesterOrder[semId]) ? state.semesterOrder[semId] : [];
        state.semesterOrder[semId] = order.filter(item => item !== code);
    });
}

function insertCourseInSemesterOrder(semesterId, code, beforeCode) {
    if (!semesterId) return;
    if (!Array.isArray(state.semesterOrder[semesterId])) {
        state.semesterOrder[semesterId] = [];
    }

    const order = state.semesterOrder[semesterId].filter(item => item !== code);
    if (beforeCode) {
        const beforeIndex = order.indexOf(beforeCode);
        if (beforeIndex >= 0) {
            order.splice(beforeIndex, 0, code);
        } else {
            order.push(code);
        }
    } else {
        order.push(code);
    }
    state.semesterOrder[semesterId] = order;
}

function reorderCourseInSemester(semesterId, code, beforeCode) {
    if (!Array.isArray(state.semesterOrder[semesterId])) {
        state.semesterOrder[semesterId] = [];
    }

    const order = state.semesterOrder[semesterId].filter(item => item !== code);
    if (beforeCode) {
        const beforeIndex = order.indexOf(beforeCode);
        if (beforeIndex >= 0) {
            order.splice(beforeIndex, 0, code);
        } else {
            order.push(code);
        }
    } else {
        order.push(code);
    }
    state.semesterOrder[semesterId] = order;
}
