// ============================================================
// API
// ============================================================

const COURSE_PROXY = 'https://aged-union-1d6f.deerain.workers.dev/?url=';
const semesterCache = {};

async function ensureCourseSemesters(code) {
    if (semesterCache[code]) return semesterCache[code];

    // Check if the course already has semester data from the scraper/cache
    const existingCourse = state.courses.find(c => c.code === code);
    if (existingCourse && existingCourse.semesters && Object.keys(existingCourse.semesters).length > 0) {
        semesterCache[code] = existingCourse.semesters;
        return existingCourse.semesters;
    }

    // Get all unique years from the degree's semester definitions
    const years = [...new Set(SEMESTERS.map(s => s.year))].sort();
    const result = {}; // { year: [1], year: [1, 2], ... }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const courseUrl = `https://programs-courses.uq.edu.au/course.html?course_code=${encodeURIComponent(code)}`;
        const res = await fetch(COURSE_PROXY + encodeURIComponent(courseUrl), {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();

        // Extract all semester offerings from the course page HTML
        // Matches patterns like: "Semester 1, 2026" or "Semester 2, 2025"
        const offeringRegex = /Semester\s+(\d),\s+(\d{4})/g;
        let match;
        while ((match = offeringRegex.exec(html)) !== null) {
            const semNum = parseInt(match[1]);
            const year = parseInt(match[2]);
            if (!result[year]) result[year] = [];
            if (!result[year].includes(semNum)) result[year].push(semNum);
        }

        // Sort semester arrays
        for (const y in result) {
            result[y].sort();
        }
    } catch (e) {
        // If fetch fails, leave result empty — course will be placeable anywhere
    }

    // For years with no data (e.g. future years), prefer 2025 data
    // as the most reliable reference, then fall back to nearest earlier year.
    // If no data exists at all, leave unset so the course is placeable anywhere.
    for (const y of years) {
        if (!result[y]) {
            if (result[2025]) {
                result[y] = [...result[2025]];
            } else if (result[2026]) {
                result[y] = [...result[2026]];
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

const cachedDegrees = localStorage.getItem('uq_tracker_cached_degrees');
if (cachedDegrees) {
    try { DEGREES = JSON.parse(cachedDegrees); } catch(e) {}
}

let currentDegreeId = localStorage.getItem('uq_tracker_degree');
let COURSES = [];
let REQUIREMENTS = [];
let SEMESTERS = [];

if (currentDegreeId && DEGREES[currentDegreeId]) {
    COURSES = DEGREES[currentDegreeId].courses;
    REQUIREMENTS = DEGREES[currentDegreeId].requirements;
    SEMESTERS = DEGREES[currentDegreeId].semesters;
} else {
    currentDegreeId = null;
}

let state = {
    courses: [...COURSES],
    placements: {},
    semesterOrder: {},
    activeFilter: 'All',
    searchQuery: '',
    shortlist: [],
    activeTab: 'plan'
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

window.addEventListener('DOMContentLoaded', () => {
    // If no degree is set perfectly in localStorage, show onboarding
    const stored = localStorage.getItem('uq_tracker_degree');
    if (!stored || !DEGREES[stored]) {
        document.getElementById('onboardingScreen').classList.remove('hidden');
    } else {
        document.getElementById('onboardingScreen').classList.add('hidden');
    }
    initApp();
    updateUIDegreeTitles();
});

// ============================================================
// CASCADING UI LOGIC
// ============================================================

window.refreshCascadingDropdowns = null;

function initCascadingDropdowns() {
    if (!dom.selProgram || !dom.selMajor || !dom.selMinor || !dom.selYear) return;

    function populateFromMap(selectEl, arrayConfig, currentId) {
        selectEl.innerHTML = '';
        if (!arrayConfig || !arrayConfig.length) return;
        
        let found = false;
        arrayConfig.forEach(item => {
            const opt = document.createElement('option');
            let id = item.id !== undefined ? item.id : item;
            let label = item.label !== undefined ? item.label : item;
            opt.value = id;
            opt.textContent = label;
            if (id.toString() === (currentId || '').toString()) {
                opt.selected = true;
                found = true;
            }
            selectEl.appendChild(opt);
        });
        
        if (!found && selectEl.options.length > 0) {
            selectEl.options[0].selected = true;
        }
    }

    window.refreshCascadingDropdowns = function() {
        populateFromMap(dom.selProgram, UQ_OPTIONS.programs, dom.selProgram.value);
        const selProg = dom.selProgram.value || UQ_OPTIONS.programs[0].id;

        const availableMajors = UQ_OPTIONS.majors[selProg] || [];
        if (availableMajors.length > 0 && !availableMajors.find(m => m.id === dom.selMajor.value)) {
            dom.selMajor.value = availableMajors[0].id;
        }
        populateFromMap(dom.selMajor, availableMajors, dom.selMajor.value);
        const selMaj = dom.selMajor.value || availableMajors[0]?.id;

        const availableMinors = UQ_OPTIONS.minors[selMaj] || [{ id: 'NONE', label: 'No Minor' }];
        if (availableMinors.length > 0 && !availableMinors.find(m => m.id === dom.selMinor.value)) {
            dom.selMinor.value = availableMinors[0].id;
        }
        populateFromMap(dom.selMinor, availableMinors, dom.selMinor.value);

        const availableYears = UQ_OPTIONS.years.slice().sort().reverse();
        if (availableYears.length > 0 && !availableYears.includes(parseInt(dom.selYear.value))) {
            dom.selYear.value = availableYears[0];
        }
        populateFromMap(dom.selYear, availableYears, dom.selYear.value);

        if (dom.selYear.options.length > 0) {
            dom.selYear.disabled = false;
        }
    };

    [dom.selProgram, dom.selMajor, dom.selMinor].forEach(el => {
        el.addEventListener('change', () => {
            window.refreshCascadingDropdowns();
        });
    });

    // Start Planning Button confirms the choice and hides onboarding
    const startBtn = document.getElementById('startPlanningBtn');
    if (startBtn && !startBtn.dataset.bound) {
        startBtn.dataset.bound = "true";
        startBtn.addEventListener('click', async () => {
            const selProg = dom.selProgram.value || UQ_OPTIONS.programs[0].id;
            const selMaj = dom.selMajor.value || UQ_OPTIONS.majors[selProg][0].id;
            const selMin = dom.selMinor.value || (UQ_OPTIONS.minors[selMaj] ? UQ_OPTIONS.minors[selMaj][0].id : 'NONE');
            const selYear = dom.selYear.value || UQ_OPTIONS.years[0];

            const majorObj = (UQ_OPTIONS.majors[selProg] || []).find(m => m.id === selMaj);
            const minorObj = (UQ_OPTIONS.minors[selMaj] || []).find(m => m.id === selMin);

            const majTitle = majorObj ? majorObj.label : selMaj;
            const minTitle = minorObj ? minorObj.label : selMin;

            // Show Loading UI
            startBtn.style.display = 'none';
            const scraperUI = document.getElementById('scraperLoadingUI');
            scraperUI.classList.remove('is-hidden');
            scraperUI.style.display = 'flex';
            
            const statusEl = document.getElementById('scraperStatus');
            const barEl = document.getElementById('scraperProgressBar');

            window.updateScraperProgress = (current, max) => {
                statusEl.textContent = `Scraping UQ Course Prerequisites (${current}/${max})...`;
                barEl.style.width = `${Math.min(100, (current / max) * 100)}%`;
            };

            try {
                // Call scraper.js explicitly
                const newConfig = await scrapeLiveDegree(majTitle, selProg, selMaj, selMin, minTitle, selYear);
                
                // Cache it
                DEGREES[newConfig.id] = newConfig;
                localStorage.setItem('uq_tracker_cached_degrees', JSON.stringify(DEGREES));
                
                // Finalize
                changeDegree(newConfig.id);
                document.getElementById('onboardingScreen').classList.add('hidden');
            } catch(e) {
                console.error(e);
                alert("Failed to scrape UQ degree! The proxy might be down or UQ blocked it. " + e.message);
            } finally {
                startBtn.style.display = 'block';
                const scraperUI = document.getElementById('scraperLoadingUI');
                scraperUI.classList.add('is-hidden');
                scraperUI.style.display = 'none';
            }
        });
    }

    // Initial populate
    window.refreshCascadingDropdowns();
}

function updateUIDegreeTitles() {
    const d = DEGREES[currentDegreeId];
    if (d) {
        document.getElementById('dispDegreeTitle').textContent = d.title; // e.g., "Software Engineering (AI Minor)"
        document.getElementById('dispDegreeYear').textContent = d.programTitle + " " + d.years; // e.g. BE(Hons) 2024 to 2027
    }
}

async function initApp() {
    applyInitialTheme();

    dom.degreeSelect = document.getElementById('degreeSelect');
    dom.selProgram = document.getElementById('selProgram');
    dom.selMajor = document.getElementById('selMajor');
    dom.selMinor = document.getElementById('selMinor');
    dom.selYear = document.getElementById('selYear');
    dom.changeDegreeBtn = document.getElementById('changeDegreeBtn');
    if (dom.changeDegreeBtn) dom.changeDegreeBtn.addEventListener('click', () => {
        document.getElementById('onboardingScreen').classList.remove('hidden');
        if (window.refreshCascadingDropdowns) window.refreshCascadingDropdowns();
    });

    initCascadingDropdowns();

    dom.courseSearch = document.getElementById('courseSearch');
    dom.resetBtn = document.getElementById('resetBtn');
    dom.undoBtn = document.getElementById('undoBtn');
    dom.redoBtn = document.getElementById('redoBtn');
    dom.shareBtn = document.getElementById('shareBtn');
    dom.exportBtn = document.getElementById('exportBtn');

    dom.semestersGrid = document.getElementById('semestersGrid');
    dom.progressDashboard = document.getElementById('progressDashboard');
    dom.loadingBar = document.getElementById('loadingBar');
    dom.loadingBarFill = document.getElementById('loadingBarFill');
    dom.loadingBarText = document.getElementById('loadingBarText');

    dom.tabBtnPlan = document.getElementById('tabBtnPlan');
    dom.tabBtnCourses = document.getElementById('tabBtnCourses');
    dom.planContent = document.getElementById('planContent');
    dom.coursesContent = document.getElementById('coursesContent');

    dom.quickAddSearch = document.getElementById('quickAddSearch');
    dom.quickAddDropdown = document.getElementById('quickAddDropdown');
    dom.shortlistContainer = document.getElementById('shortlistContainer');
    dom.unassignedList = document.getElementById('unassignedList');
    dom.coursesGrid = document.getElementById('coursesGrid');

    dom.semesterPickerPopup = document.getElementById('semesterPickerPopup');
    dom.semesterPickerOptions = document.getElementById('semesterPickerOptions');

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

    if (dom.tabBtnPlan) dom.tabBtnPlan.addEventListener('click', () => switchTab('plan'));
    if (dom.tabBtnCourses) dom.tabBtnCourses.addEventListener('click', () => switchTab('courses'));

    if (dom.courseSearch) {
        dom.courseSearch.addEventListener('input', e => {
            state.searchQuery = e.target.value.toLowerCase();
            renderCoursesTab();
        });
    }

    if (dom.quickAddSearch) {
        dom.quickAddSearch.addEventListener('input', handleQuickAddInput);
        dom.quickAddSearch.addEventListener('focus', handleQuickAddInput);
    }

    document.addEventListener('click', (e) => {
        if (dom.quickAddSearch && !dom.quickAddSearch.contains(e.target) && !dom.quickAddDropdown.contains(e.target)) {
            dom.quickAddDropdown.classList.add('is-hidden');
        }
        if (dom.semesterPickerPopup && !dom.semesterPickerPopup.classList.contains('is-hidden') &&
            !e.target.closest('#semesterPickerPopup') && !e.target.closest('.add-to-plan-btn') && !e.target.closest('.dropdown-item')) {
            dom.semesterPickerPopup.classList.add('is-hidden');
            state.activePickerCourse = null;
        }
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
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (dom.quickAddDropdown) dom.quickAddDropdown.classList.add('is-hidden');
            if (dom.semesterPickerPopup) dom.semesterPickerPopup.classList.add('is-hidden');
            state.activePickerCourse = null;
        }
    });

    if (dom.unassignedList) {
        dom.unassignedList.addEventListener('dragover', handleDragOver);
        dom.unassignedList.addEventListener('drop', handleDrop);
        dom.unassignedList.addEventListener('dragenter', handleDragEnter);
        dom.unassignedList.addEventListener('dragleave', handleDragLeave);
    }
    if (dom.shortlistContainer) {
        dom.shortlistContainer.addEventListener('dragover', handleDragOver);
        dom.shortlistContainer.addEventListener('drop', handleDrop);
        dom.shortlistContainer.addEventListener('dragenter', handleDragEnter);
        dom.shortlistContainer.addEventListener('dragleave', handleDragLeave);
    }

    await fetchSemestersAndRender();
}

// ============================================================
// DEGREE
// ============================================================

async function fetchSemestersAndRender() {
    const realCodes = state.courses
        .filter(c => /^[A-Z]{4}\d{4}$/.test(c.code))
        .map(c => c.code);
    const total = realCodes.length;

    if (total > 0) {
        if (dom.loadingBar) {
            dom.loadingBar.classList.remove('is-hidden');
            dom.loadingBarText.textContent = `LOADING SEMESTERS 0/${total}`;
            dom.loadingBarFill.style.display = 'block';
            dom.loadingBarFill.style.width = '0%';
        }
        let completed = 0;

        const promises = realCodes.map(code =>
            ensureCourseSemesters(code).then(sems => {
                const cInfo = state.courses.find(c => c.code === code);
                if (cInfo) cInfo.semesters = sems;
            }).catch(err => {
                console.warn(`Failed to load semesters for ${code}:`, err);
            }).finally(() => {
                completed++;
                const pct = Math.round((completed / total) * 100);
                if (dom.loadingBarFill) dom.loadingBarFill.style.width = pct + '%';
                if (dom.loadingBarText) dom.loadingBarText.textContent = `LOADING SEMESTERS ${completed}/${total}`;
            })
        );

        await Promise.all(promises);

        if (dom.loadingBar) dom.loadingBar.classList.add('is-hidden');

        renderSemesters();
        renderCoursesTab();
        renderShortlist();
    } else {
        if (dom.loadingBar) dom.loadingBar.classList.add('is-hidden');
    }
}

async function changeDegree(newDegreeId) {
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

    updateUIDegreeTitles();
    saveState();
    loadState();
    initializeHistory();
    renderFilters();
    updateHistoryControls();

    await fetchSemestersAndRender();
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

    // Add Shortlist filter pill
    const wishlistBtn = document.createElement('button');
    wishlistBtn.className = `filter-pill${state.activeFilter === 'Shortlist' ? ' active' : ''}`;
    wishlistBtn.dataset.cat = 'Shortlist';
    wishlistBtn.textContent = '★ Shortlist';
    container.appendChild(wishlistBtn);

    // Unified click handler for all filter pills (including Shortlist)
    const filterBtns = container.querySelectorAll('.filter-pill');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const clickedCat = btn.dataset.cat;
            // Toggle: if already active, go back to All
            if (state.activeFilter === clickedCat && clickedCat !== 'All') {
                state.activeFilter = 'All';
            } else {
                state.activeFilter = clickedCat;
            }
            filterBtns.forEach(b => b.classList.remove('active'));
            const activePill = container.querySelector(`[data-cat="${state.activeFilter}"]`);
            if (activePill) activePill.classList.add('active');
            renderCoursesTab();
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
                state.shortlist = Array.isArray(parsed.shortlist) ? parsed.shortlist : [];
            } else {
                state.placements = parsed;
                state.semesterOrder = {};
                state.shortlist = [];
            }
        } catch (e) {
        }
    } else {
        state.placements = {};
        state.semesterOrder = {};
        state.shortlist = [];
    }
}

function saveState() {
    localStorage.setItem(`uq_tracker_state_${currentDegreeId}`, JSON.stringify({
        placements: state.placements,
        semesterOrder: state.semesterOrder,
        shortlist: state.shortlist
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

        const wrapper = document.getElementById('planContent');
        const oldOverflow = wrapper.style.overflow;
        const oldWidth = dom.semestersGrid.style.width;

        // Let the grid expand fully to capture all semesters without scrolling bounds
        wrapper.style.overflow = 'visible';
        dom.semestersGrid.style.width = 'max-content';

        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim() || '#ffffff';
        const canvas = await html2canvas(dom.semestersGrid, {
            scale: 2,
            backgroundColor: bgColor,
            useCORS: true,
            logging: false
        });

        wrapper.style.overflow = oldOverflow;
        dom.semestersGrid.style.width = oldWidth;

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
    return 'light';
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
        box.className = 'semester-col';

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
                card.classList.add('inverted'); // Added to plan

                if (cInfo.isYearLong && Array.isArray(state.placements[code])) {
                    if (state.placements[code][1] === sem.id) {
                        card.querySelector('.course-name').innerHTML += ' <span style="font-weight: 500;">(Part 2)</span>';
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
        if (units > 8) header.querySelector('.semester-units').style.fontWeight = '700';

        box.appendChild(header);
        box.appendChild(dropzone);
        dom.semestersGrid.appendChild(box);
    });
}

function switchTab(tabId) {
    state.activeTab = tabId;
    if (tabId === 'plan') {
        dom.tabBtnPlan.classList.add('active');
        dom.tabBtnCourses.classList.remove('active');
        if (dom.planContent) dom.planContent.classList.remove('is-hidden');
        if (dom.coursesContent) dom.coursesContent.classList.add('is-hidden');
    } else {
        dom.tabBtnCourses.classList.add('active');
        dom.tabBtnPlan.classList.remove('active');
        if (dom.coursesContent) dom.coursesContent.classList.remove('is-hidden');
        if (dom.planContent) dom.planContent.classList.add('is-hidden');
        renderCoursesTab();
    }
}

function renderCoursesTab() {
    if (!dom.coursesGrid) return;
    dom.coursesGrid.innerHTML = '';

    state.courses.forEach(c => {
        // Handle shortlist filter — exclude courses already in the plan
        if (state.activeFilter === 'Shortlist') {
            const inPlan = !!state.placements[c.code] && state.placements[c.code] !== 'unassigned';
            if (!state.shortlist.includes(c.code) || inPlan) return;
        } else {
            const matchCat = state.activeFilter === 'All' || c.cat === state.activeFilter;
            if (!matchCat) return;
        }
        const matchSearch = c.code.toLowerCase().includes(state.searchQuery) || c.name.toLowerCase().includes(state.searchQuery);
        if (!matchSearch) return;

        const card = createCourseCard(c);
        card.draggable = false;

        if (state.searchQuery) {
            const codeEl = card.querySelector('.course-code-text');
            const nameEl = card.querySelector('.course-name');
            if (codeEl) codeEl.innerHTML = highlightSearchText(c.code, state.searchQuery);
            if (nameEl) nameEl.innerHTML = highlightSearchText(c.name, state.searchQuery);
        }

        const actionsDiv = card.querySelector('.card-actions');
        if (actionsDiv) {
            const inPlan = !!state.placements[c.code] && state.placements[c.code] !== 'unassigned';
            const isShortlisted = state.shortlist.includes(c.code);

            if (inPlan) {
                const btnRemove = `<button type="button" class="strict-btn btn-remove-plan" style="grid-column: 1 / -1;" data-code="${c.code}">− Remove from Plan</button>`;
                actionsDiv.innerHTML = `${btnRemove}`;
                const elRemove = actionsDiv.querySelector('.btn-remove-plan');
                if (elRemove) elRemove.addEventListener('click', () => removeFromPlan(c.code));
            } else {
                let btnShortlist = isShortlisted
                    ? `<button type="button" class="strict-btn inverted" style="cursor:default;" disabled>Shortlisted ✓</button>`
                    : `<button type="button" class="strict-btn btn-shortlist" data-code="${c.code}">+ Shortlist</button>`;
                const btnAdd = `<button type="button" class="strict-btn add-to-plan-btn" data-code="${c.code}">+ Add to Plan →</button>`;
                actionsDiv.innerHTML = `${btnShortlist}${btnAdd}`;

                const elShortlist = actionsDiv.querySelector('.btn-shortlist');
                if (elShortlist) elShortlist.addEventListener('click', () => addToShortlist(c.code));
                const elAdd = actionsDiv.querySelector('.add-to-plan-btn');
                if (elAdd) elAdd.addEventListener('click', (e) => showSemesterPicker(c.code, e.target));
            }
        }
        dom.coursesGrid.appendChild(card);
    });
}

function addToShortlist(code) {
    if (!state.shortlist.includes(code)) {
        state.shortlist.push(code);
        saveState();
        renderCoursesTab();
        renderShortlist();
    }
}

function removeFromShortlist(code) {
    state.shortlist = state.shortlist.filter(c => c !== code);
    saveState();
    renderCoursesTab();
    renderShortlist();
}

function renderShortlist() {
    if (!dom.shortlistContainer) return;
    dom.shortlistContainer.innerHTML = '';

    // Filter out items that are already placed
    const validShortlist = state.shortlist.filter(code => {
        return !(state.placements[code] && state.placements[code] !== 'unassigned');
    });

    if (validShortlist.length === 0) {
        dom.shortlistContainer.innerHTML = `<div class="empty-placeholder">— no courses shortlisted</div>`;
        return;
    }

    validShortlist.forEach(code => {
        const cInfo = getCourseInfo(code);
        if (!cInfo) return;

        const el = document.createElement('div');
        el.className = 'shortlist-item';
        el.draggable = true;
        el.id = 'shortlist-' + cInfo.code;
        el.dataset.code = cInfo.code;

        el.innerHTML = `
            <span class="shortlist-handle">⠿</span>
            <span style="font-weight: 500;">${cInfo.code}</span>
            <span style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; margin: 0 8px;">${cInfo.name}</span>
            <button class="shortlist-remove" title="Remove" data-code="${cInfo.code}">×</button>
        `;

        el.querySelector('.shortlist-remove').addEventListener('click', () => removeFromShortlist(cInfo.code));
        el.addEventListener('dragstart', handleDragStart);
        el.addEventListener('dragend', handleDragEnd);

        dom.shortlistContainer.appendChild(el);
    });
}

function handleQuickAddInput(e) {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
        dom.quickAddDropdown.classList.add('is-hidden');
        return;
    }

    dom.quickAddDropdown.innerHTML = '';
    let matches = 0;

    for (const c of state.courses) {
        if (state.placements[c.code] && state.placements[c.code] !== 'unassigned') continue;

        if (c.code.toLowerCase().includes(query) || c.name.toLowerCase().includes(query)) {
            matches++;
            const item = document.createElement('div');
            item.className = 'dropdown-item';

            const codeHTML = highlightSearchText(c.code, query);
            const nameHTML = highlightSearchText(c.name, query);

            item.innerHTML = `
                <div><span style="font-weight: 500;">${codeHTML}</span> <span style="font-size: 12px; margin-left:8px;">${nameHTML}</span></div>
                <div style="font-size: 16px; font-weight: 500;">+</div>
            `;

            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                showSemesterPicker(c.code, dom.quickAddSearch);
                dom.quickAddDropdown.classList.add('is-hidden');
                dom.quickAddSearch.value = '';
            });

            dom.quickAddDropdown.appendChild(item);
            if (matches >= 6) break;
        }
    }

    if (matches > 0) {
        dom.quickAddDropdown.classList.remove('is-hidden');
    } else {
        dom.quickAddDropdown.classList.add('is-hidden');
    }
}

function showSemesterPicker(code, anchorEl) {
    state.activePickerCourse = code;
    const cInfo = getCourseInfo(code);
    if (!cInfo) return;

    dom.semesterPickerOptions.innerHTML = '';

    // Position picker
    const rect = anchorEl.getBoundingClientRect();
    dom.semesterPickerPopup.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    let left = rect.left + window.scrollX;
    if (left + 300 > window.innerWidth) {
        left = window.innerWidth - 320;
    }
    dom.semesterPickerPopup.style.left = Math.max(8, left) + 'px';

    // Group semesters by year
    const years = [...new Set(SEMESTERS.map(s => s.year))].sort();

    years.forEach(year => {
        const yearSems = SEMESTERS.filter(s => s.year === year);

        const row = document.createElement('div');
        row.className = 'picker-year-row';

        const yearLabel = document.createElement('div');
        yearLabel.className = 'picker-year-label';
        yearLabel.textContent = year;
        row.appendChild(yearLabel);

        const btnsWrap = document.createElement('div');
        btnsWrap.className = 'picker-year-btns';

        yearSems.forEach(sem => {
            const placedCodes = Object.keys(state.placements).filter(c => {
                const placement = state.placements[c];
                if (Array.isArray(placement)) return placement.includes(sem.id);
                return placement === sem.id;
            });

            let units = 0;
            placedCodes.forEach(pc => {
                const inf = getCourseInfo(pc);
                if (inf) units += inf.isYearLong ? (inf.units / 2) : inf.units;
            });

            const alreadyAdded = placedCodes.includes(code);
            const isFull = units >= 8;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'strict-btn';

            if (alreadyAdded) {
                btn.textContent = `S${sem.semNum} — added`;
                btn.disabled = true;
                btn.style.color = 'var(--disabled-color)';
                btn.style.borderColor = 'var(--disabled-color)';
            } else if (isFull) {
                btn.textContent = `S${sem.semNum} (Full)`;
                btn.disabled = true;
                btn.style.color = 'var(--disabled-color)';
                btn.style.borderColor = 'var(--disabled-color)';
            } else {
                btn.textContent = `S${sem.semNum}`;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    if (cInfo.isYearLong) {
                        const idx = SEMESTERS.findIndex(s => s.id === sem.id);
                        if (idx + 1 < SEMESTERS.length) {
                            const nextSem = SEMESTERS[idx + 1];
                            state.placements[code] = [sem.id, nextSem.id];
                            insertCourseInSemesterOrder(sem.id, code, null);
                            insertCourseInSemesterOrder(nextSem.id, code, null);
                        } else {
                            alert("Part 2 requires another semester after this one.");
                            return;
                        }
                    } else {
                        state.placements[code] = sem.id;
                        insertCourseInSemesterOrder(sem.id, code, null);
                    }

                    removeFromShortlist(code);
                    saveState();
                    renderAll();
                    dom.semesterPickerPopup.classList.add('is-hidden');
                    state.activePickerCourse = null;
                });
            }

            btnsWrap.appendChild(btn);
        });

        row.appendChild(btnsWrap);
        dom.semesterPickerOptions.appendChild(row);
    });

    dom.semesterPickerPopup.classList.remove('is-hidden');
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
        const filtered = plannedCourses.filter(c => {
            if (!req.validCats || req.validCats.length === 0) return true; // Total Units fallback
            return req.validCats.includes(c.cat);
        });
        const sum = filtered.reduce((acc, crs) => acc + crs.units, 0);
        const percentage = Math.min(100, Math.round((sum / req.target) * 100));

        const widget = document.createElement('div');
        widget.className = 'progress-item';
        widget.innerHTML = `
      <div class="progress-item-title">${req.name}</div>
      <div class="progress-item-fraction">${sum} / ${req.target} U</div>
    `;
        dom.progressDashboard.appendChild(widget);
    });
}

function getCourseInfo(code) {
    return state.courses.find(c => c.code === code);
}

function renderAll() {
    renderSemesters();
    renderCoursesTab();
    renderShortlist();
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

    const excludesHtml = (c.exclusiveWith && c.exclusiveWith.length > 0)
        ? `<div class="course-excludes">Excludes: ${c.exclusiveWith.join(', ')}</div>`
        : '';

    const semsHtml = `<div class="sem-info">Loading semesters...</div>`;

    const isRealCourse = /^[A-Z]{4}\d{4}$/.test(c.code);
    const linkHtml = isRealCourse
        ? `<a class="course-link" href="https://programs-courses.uq.edu.au/course.html?course_code=${c.code}" target="_blank" draggable="false">Page ↗</a>`
        : '';

    const deleteCustomHtml = c.isCustom
        ? '<button class="custom-course-delete" type="button" draggable="false" aria-label="Delete custom elective">×</button>'
        : '';

    const isRequired = c.cat === 'Core' || c.cat === 'Required';
    const markerHtml = `<div class="course-marker ${isRequired ? 'required' : ''}"></div>`;

    el.innerHTML = `
    <div class="course-header">
      <div class="course-meta-left">
        ${markerHtml}
        <strong class="course-code-text">${c.code}</strong>
        <span class="course-tag top-tag">${c.cat}</span>
        <span class="course-tag top-tag course-units">${c.units} U</span>
      </div>
      <span class="course-code-actions">${linkHtml}${deleteCustomHtml}</span>
    </div>
    <div class="course-name" title="${c.name}">${c.name}</div>
    ${excludesHtml}
    <div class="course-meta-bottom">
      <span class="course-tag">${c.cat}</span>
      <span class="course-tag course-units">${c.units} U</span>
    </div>
    <button type="button" class="planner-remove-btn" draggable="false" aria-label="Remove from plan">Remove</button>
    <div class="card-actions" id="actions-${c.code}"></div>
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

    const removeBtn = el.querySelector('.planner-remove-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeFromPlan(c.code);
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
    renderCoursesTab();
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
    // Disabled intentionally: availability text removed from design
}

function removeFromPlan(code) {
    if (!state.placements[code] || state.placements[code] === 'unassigned') return;
    state.placements[code] = 'unassigned';
    removeCourseFromSemesterOrder(code);
    saveState();
    renderAll();
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
    const isRemovalZone = targetId === 'unassignedList' || targetId === 'shortlistContainer';
    const targetSemesterId = isRemovalZone ? null : targetId;
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

    if (!isRemovalZone) {
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

    if (isRemovalZone) {
        state.placements[code] = 'unassigned';
        removeCourseFromSemesterOrder(code);
        if (targetId === 'shortlistContainer') {
            if (!state.shortlist.includes(code)) state.shortlist.push(code);
        }
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
