const PROXY_URL = 'https://aged-union-1d6f.deerain.workers.dev/?url=';
const courseCache = {};

async function fetchUQRaw(url) {
    try {
        const res = await fetch(PROXY_URL + encodeURIComponent(url));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } catch (e) {
        console.warn('Fetch error:', e);
        return null;
    }
}

function extractAppData(html) {
    if (!html) return null;
    const match = html.match(/window\.AppData\s*=\s*(\{.*?\});\s*<\/script>/s);
    if (!match) return null;
    return JSON.parse(match[1]);
}

function stripHtmlAndNormalize(text) {
    if (!text) return null;
    return text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim() || null;
}

// Global hook to update progress bar in UI
window.updateScraperProgress = function (current, max) { };

async function scrapeCourseDetailsDynamically(code) {
    if (courseCache[code]) return courseCache[code];

    const courseUrl = `https://programs-courses.uq.edu.au/course.html?course_code=${encodeURIComponent(code)}`;
    const html = await fetchUQRaw(courseUrl);
    if (!html) {
        courseCache[code] = { prereqs: [] };
        return courseCache[code];
    }
    const prereqMatch = html.match(/<p[^>]*id=["']course-prerequisite["'][^>]*>([\s\S]*?)<\/p>/i);
    const prereqText = stripHtmlAndNormalize(prereqMatch ? prereqMatch[1] : null) || '';
    const prereqs = Array.from(new Set(prereqText.match(/[A-Z]{4}\d{4}/g) || []));
    courseCache[code] = { prereqs };
    return courseCache[code];
}

async function scrapeLiveDegree(majorTitle, programId, majorId, minorId, minorTitle, year) {

    const urls = {
        prog: `https://programs-courses.uq.edu.au/requirements/program/${programId}/${year}`,
        plan: majorId !== 'NONE' ? `https://programs-courses.uq.edu.au/requirements/plan/${majorId}/${year}` : null,
        minor: minorId !== 'NONE' ? `https://programs-courses.uq.edu.au/requirements/plan/${minorId}/${year}` : null
    };

    const [progHtml, planHtml, minorHtml] = await Promise.all([
        fetchUQRaw(urls.prog),
        urls.plan ? fetchUQRaw(urls.plan) : null,
        urls.minor ? fetchUQRaw(urls.minor) : null
    ]);

    const progData = extractAppData(progHtml);
    const planData = urls.plan ? extractAppData(planHtml) : null;
    const minorData = urls.minor ? extractAppData(minorHtml) : null;

    if (!progData) {
        throw new Error("Could not parse Program HTML from UQ.");
    }

    const courses = [];
    const seen = new Set();

    const hardcodedExclusives = {
        'ENGG1001': ['CSSE1001'], 'CSSE1001': ['ENGG1001'],
        'MATH1051': ['MATH1071'], 'MATH1071': ['MATH1051'],
        'MATH1052': ['MATH1072'], 'MATH1072': ['MATH1052']
    };

    function processCourseRef(ref, sectionPath, isExclusiveGroup, groupCodes, determineCatFn) {
        const code = ref.code;
        if (!code) return;

        let existing = courses.find(c => c.code === code);
        const cat = determineCatFn(sectionPath, code);

        if (!existing && cat) {
            existing = { code: code, name: ref.name || code, units: ref.unitsMaximum || 2, cat: cat };
            if (code === 'REIT4841' || code === 'REIT4842') existing.isYearLong = true;
            courses.push(existing);
            seen.add(code);
            existing.exclusiveWith = [];
        } else if (existing && cat && existing.cat !== cat) {
            if (cat === 'Minor') existing.cat = cat;
        }

        if (existing) {
            const excl = isExclusiveGroup ? groupCodes.filter(c => c !== code) : [];
            if (hardcodedExclusives[code]) {
                hardcodedExclusives[code].forEach(e => {
                    if (!excl.includes(e)) excl.push(e);
                });
            }
            if (!existing.exclusiveWith) existing.exclusiveWith = [];
            excl.forEach(e => {
                if (!existing.exclusiveWith.includes(e)) existing.exclusiveWith.push(e);
            });
        }
    }

    function traverseTree(node, determineCatFn, sectionPath = '') {
        if (Array.isArray(node)) {
            for (const item of node) traverseTree(item, determineCatFn, sectionPath);
        } else if (typeof node === 'object' && node !== null) {
            const rt = node.rowType;
            if (rt === 'CurriculumReference' && node.curriculumReference) {
                processCourseRef(node.curriculumReference, sectionPath, false, [], determineCatFn);
            } else if (rt === 'EquivalenceGroup' && Array.isArray(node.equivalenceGroup)) {
                const groupCodes = node.equivalenceGroup.map(eg => eg.curriculumReference?.code).filter(Boolean);
                for (const eg of node.equivalenceGroup) {
                    if (eg.curriculumReference) processCourseRef(eg.curriculumReference, sectionPath, true, groupCodes, determineCatFn);
                }
            } else if (node.header?.title) {
                const title = node.header.title;
                const nextPath = sectionPath ? `${sectionPath} > ${title}` : title;
                if (Array.isArray(node.body)) traverseTree(node.body, determineCatFn, nextPath);
            } else if (Array.isArray(node.body)) {
                traverseTree(node.body, determineCatFn, sectionPath);
            }
        }
    }

    function getRuleN(part) {
        if (!part || !part.header || !part.header.selectionRule) return 0;
        const param = (part.header.selectionRule.params || []).find(p => p.name === 'N');
        return param ? param.value : 0;
    }

    function getRuleM(part) {
        if (!part || !part.header || !part.header.selectionRule) return 0;
        const param = (part.header.selectionRule.params || []).find(p => p.name === 'M');
        return param ? param.value : 0;
    }

    let coreLabel = "Core";
    let coreTarget = 0;
    let majorCoreLabel = "Major Core";
    let majorCoreTarget = 0;

    const progRules = progData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES')?.payload;
    if (progRules) {
        const corePart = progRules.body[0];
        const optionPart = progRules.body.find(p => p.header?.title?.toLowerCase().includes('option'));

        if (corePart) {
            coreLabel = (corePart.header?.title || "Core").replace(/ courses/gi, "").replace(/hons\)/gi, "Hons)");
            coreTarget = getRuleN(corePart);
            traverseTree(corePart.body || [], () => 'Core');
        }
        if (optionPart) {
            traverseTree(optionPart.body || [], (path) => {
                const s = path.toLowerCase();
                if (s.includes('extension') || s.includes('research')) return 'Major Ext';
                if (s.includes('advanced')) return 'Major Adv';
                if (s.includes('elective')) return 'Elective';
                return 'Major Options';
            });
        }
    }

    if (planData) {
        const planRules = planData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES')?.payload;
        if (planRules) {
            const majorCorePart = planRules.body.find(p => p.header?.title?.toLowerCase().includes('compulsory'));
            if (majorCorePart) {
                majorCoreLabel = (majorCorePart.header?.title || "Major Core").replace(/ courses/gi, "").replace(/compulsory/gi, "Core");
                majorCoreTarget = getRuleN(majorCorePart);
                traverseTree(majorCorePart.body || [], () => 'Major Core');
            }
        }
    }

    let minorUnits = 0;
    if (minorData) {
        const minorRules = minorData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES')?.payload;
        if (minorRules) {
            minorRules.body.forEach(part => minorUnits += getRuleN(part));
            traverseTree(minorRules.body || [], () => 'Minor');
        }
    }

    courses.forEach(c => {
        if (c.exclusiveWith && c.exclusiveWith.length === 0) delete c.exclusiveWith;
    });

    courses.push(
        { code: 'ELEC_GEN_1', name: 'General/BE Elective', units: 2, cat: 'Elective' },
        { code: 'ELEC_GEN_2', name: 'General/BE Elective', units: 2, cat: 'Elective' },
        { code: 'ELEC_GEN_3', name: 'General/BE Elective', units: 2, cat: 'Elective' }
    );

    const validCourseCodeRegex = /^[A-Z]{4}\d{4}$/;
    const realCourses = courses.filter(c => validCourseCodeRegex.test(c.code) && c.units <= 4);

    // FETCH ALL PREREQUISITES
    // Max 10 concurrent requests to not overwhelm proxy
    let currentTask = 0;
    async function worker() {
        while (true) {
            const index = currentTask++;
            if (index >= realCourses.length) return;
            const details = await scrapeCourseDetailsDynamically(realCourses[index].code);
            realCourses[index].prereqs = (details.prereqs || []).filter(pr => seen.has(pr));
            if (window.updateScraperProgress) window.updateScraperProgress(currentTask, realCourses.length);
        }
    }

    const workers = [];
    for (let w = 0; w < 10; w++) workers.push(worker());
    await Promise.all(workers);

    // FORMAT UI OUTPUT
    const beTotalMax = progData.programRequirements.unitsMaximum || 64;

    const reqs = [
        { id: 'total', name: 'Total Units', target: beTotalMax, validCats: [], color: 'var(--accent-color)' },
        { id: 'core', name: coreLabel, target: coreTarget, validCats: ['Core'], color: 'var(--cat-core)' },
        { id: 'majorcore', name: majorCoreLabel, target: majorCoreTarget, validCats: ['Major Core'], color: 'var(--cat-secore)' }
    ];

    if (minorId !== 'NONE') {
        reqs.push({ id: 'minor', name: minorTitle, target: minorUnits, validCats: ['Minor'], color: 'var(--cat-aiminor)' });
    }

    // Try to get elective targets dynamically if available
    let electiveTarget = 4; // fallback
    if (progRules) {
        const electivePart = progRules.body.find(p => p.header?.title?.toLowerCase().includes('elective'));
        if (electivePart) electiveTarget = getRuleN(electivePart) || 4;
    }

    reqs.push(
        { id: 'majorext', name: 'Extension / Adv', target: 2, validCats: ['Major Ext', 'Major Adv'], color: 'var(--cat-seext)' },
        { id: 'electives', name: 'Electives', target: electiveTarget, validCats: ['Elective', 'Major Options'], color: 'var(--cat-elec)' }
    );

    const semesters = [];
    const sy = parseInt(year, 10);
    for (let i = 0; i < 4; i++) {
        const yr = sy + i;
        const yy = yr.toString().slice(-2);
        semesters.push({ id: `sem-${yy}-1`, name: `${yr} Sem 1`, year: yr, semNum: 1 });
        semesters.push({ id: `sem-${yy}-2`, name: `${yr} Sem 2`, year: yr, semNum: 2 });
    }

    return {
        id: `${programId}_${majorId}_${minorId}_${year}`,
        title: `${majorTitle}${minorId !== 'NONE' ? ` (${minorTitle})` : ''}`,
        program: programId,
        major: majorId,
        minor: minorId,
        year: year,
        programTitle: progData.title || "Bachelor of Engineering (Honours)",
        majorTitle: majorTitle,
        minorTitle: minorTitle,
        years: `${sy} to ${sy + 3}`,
        semesters: semesters,
        requirements: reqs,
        courses: realCourses
    };
}
