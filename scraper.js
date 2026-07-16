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
        courseCache[code] = { prereqs: [], semesters: {} };
        return courseCache[code];
    }
    const prereqMatch = html.match(/<p[^>]*id=["']course-prerequisite["'][^>]*>([\s\S]*?)<\/p>/i);
    const prereqText = stripHtmlAndNormalize(prereqMatch ? prereqMatch[1] : null) || '';
    const prereqs = Array.from(new Set(prereqText.match(/[A-Z]{4}\d{4}/g) || []));

    // Extract semester offerings from course page
    // Matches patterns like: "Semester 1, 2026" or "Semester 2, 2025"
    const semesters = {};
    const offeringRegex = /Semester\s+(\d),\s+(\d{4})/g;
    let semMatch;
    while ((semMatch = offeringRegex.exec(html)) !== null) {
        const semNum = parseInt(semMatch[1]);
        const year = parseInt(semMatch[2]);
        if (!semesters[year]) semesters[year] = [];
        if (!semesters[year].includes(semNum)) semesters[year].push(semNum);
    }
    for (const y in semesters) semesters[y].sort();

    courseCache[code] = { prereqs, semesters };
    return courseCache[code];
}

async function scrapeLiveDegree(majorTitle, programId, majorId, minorId, minorTitle, rulesYear, startYear = rulesYear) {

    const urls = {
        prog: `https://programs-courses.uq.edu.au/requirements/program/${programId}/${rulesYear}`,
        plan: majorId !== 'NONE' ? `https://programs-courses.uq.edu.au/requirements/plan/${majorId}/${rulesYear}` : null,
        minor: minorId !== 'NONE' ? `https://programs-courses.uq.edu.au/requirements/plan/${minorId}/${rulesYear}` : null
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
    
    if (urls.plan && !planData) {
        throw new Error(`The major ${majorTitle} (${majorId}) does not seem to exist or be offered for this program in ${rulesYear}.`);
    }

    if (urls.minor && !minorData) {
        throw new Error(`The minor ${minorTitle} (${minorId}) does not seem to exist or be offered for this program in ${rulesYear}.`);
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
            existing = { code: code, name: ref.name || code, units: ref.unitsMaximum || 2, sourceCategories: [cat] };
            if (code === 'REIT4841' || code === 'REIT4842') existing.isYearLong = true;
            courses.push(existing);
            seen.add(code);
            existing.exclusiveWith = [];
        } else if (existing && cat && !existing.sourceCategories.includes(cat)) {
            existing.sourceCategories.push(cat);
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

    const categories = DegreeRules.CATEGORIES;
    const ruleContext = { rulesYear, majorId, minorId };
    let coreLabel = "BE Core";
    let coreTarget = 0;
    let majorCoreLabel = `${majorTitle} Compulsory`;
    let majorCoreTarget = 0;
    let majorExtensionTarget = 0;
    let majorAdvancedTarget = 0;

    function findSection(node, wantedTitle) {
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = findSection(item, wantedTitle);
                if (found) return found;
            }
        } else if (node && typeof node === 'object') {
            if (node.header?.title === wantedTitle) return node;
            return findSection(node.body, wantedTitle);
        }
        return null;
    }

    const progRules = progData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES')?.payload;
    if (progRules) {
        const selectedOptionsTitle = `${majorTitle} Plan Options`;
        progRules.body.forEach((part, idx) => {
            const title = part.header?.title || '';
            const lTitle = title.toLowerCase();
            const n = getRuleN(part);

            if (idx === 0 || lTitle.includes('core')) {
                if (!coreLabel || coreLabel === 'BE Core') {
                    coreLabel = title.replace(/ courses/gi, '').replace(/hons\)/gi, 'Hons)') || 'Core';
                }
                coreTarget += n;
                traverseTree(part.body || [], () => categories.PROGRAM_CORE);
            } else if (title === selectedOptionsTitle) {
                const selectedBranchTitle = minorId !== 'NONE'
                    ? `${majorTitle} Minor Options`
                    : `${majorTitle} No Major Option`;
                const selectedBranch = findSection(part.body || [], selectedBranchTitle);
                const extensionSection = findSection(selectedBranch?.body || [], `${majorTitle} Extension Course`);
                const advancedSection = findSection(selectedBranch?.body || [], `${majorTitle} Advanced Elective Courses`);
                majorExtensionTarget = getRuleN(extensionSection);
                majorAdvancedTarget = getRuleN(advancedSection);

                traverseTree(part.body || [], (path) => {
                    const s = path.toLowerCase();
                    const isSelectedBranch = s.includes(selectedBranchTitle.toLowerCase());
                    if (isSelectedBranch && (s.includes('extension') || s.includes('research'))) {
                        return categories.SOFTWARE_EXTENSION;
                    }
                    if (isSelectedBranch && s.includes('advanced')) {
                        return categories.SOFTWARE_ADVANCED;
                    }
                    if (s.includes('breadth elective')
                        || s.includes('program elective')
                        || s.includes('general elective')) {
                        return categories.OTHER_ELECTIVE;
                    }
                    return null;
                });
            }
        });
    }

    if (planData) {
        const planRules = planData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES')?.payload;
        if (planRules) {
            planRules.body.forEach(part => {
                const title = part.header?.title || '';
                const lTitle = title.toLowerCase();
                const n = getRuleN(part);
                if (lTitle.includes('compulsory') || lTitle.includes('core')) {
                    if (!majorCoreLabel || majorCoreLabel === `${majorTitle} Compulsory`) {
                        majorCoreLabel = title.replace(/ courses/gi, '').trim() || `${majorTitle} Compulsory`;
                    }
                    majorCoreTarget += n;
                    traverseTree(part.body || [], () => categories.SOFTWARE_COMPULSORY);
                } else if (lTitle.includes('elective')) {
                    traverseTree(part.body || [], () => categories.OTHER_ELECTIVE);
                }
            });
        }
    }

    let minorCompulsoryTarget = 0;
    let minorElectiveTarget = 0;
    if (minorData) {
        const minorRules = minorData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES')?.payload;
        if (minorRules) {
            minorRules.body.forEach(part => {
                const title = part.header?.title || '';
                const lTitle = title.toLowerCase();
                if (lTitle.includes('compulsory') || lTitle.includes('core')) {
                    minorCompulsoryTarget += getRuleN(part);
                    traverseTree(part.body || [], () => categories.MINOR_COMPULSORY);
                } else if (lTitle.includes('elective')) {
                    minorElectiveTarget += getRuleN(part);
                    traverseTree(part.body || [], () => categories.MINOR_ELECTIVE);
                }
            });
        }
    }

    courses.forEach(c => {
        const resolvedCategories = DegreeRules.resolveCourseCategories(c.code, c.sourceCategories, ruleContext);
        c.cat = resolvedCategories[0];
        if (resolvedCategories.length > 1) c.categoryOptions = resolvedCategories;
        delete c.sourceCategories;
        if (c.exclusiveWith && c.exclusiveWith.length === 0) delete c.exclusiveWith;
    });

    courses.push(
        { code: 'ELEC_GEN_1', name: 'General/BE Elective', units: 2, cat: categories.OTHER_ELECTIVE },
        { code: 'ELEC_GEN_2', name: 'General/BE Elective', units: 2, cat: categories.OTHER_ELECTIVE },
        { code: 'ELEC_GEN_3', name: 'General/BE Elective', units: 2, cat: categories.OTHER_ELECTIVE }
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
            if (details.semesters && Object.keys(details.semesters).length > 0) {
                realCourses[index].semesters = details.semesters;
            }
            if (window.updateScraperProgress) window.updateScraperProgress(currentTask, realCourses.length);
        }
    }

    const workers = [];
    for (let w = 0; w < 10; w++) workers.push(worker());
    await Promise.all(workers);

    // FORMAT UI OUTPUT
    const beTotalMax = progData.programRequirements?.unitsMaximum || progData.programRequirements?.unitsMinimum || 48;
    const yearsOfStudy = Math.ceil(beTotalMax / 16);

    const reqs = [
        { id: 'total', name: 'Total Units', target: beTotalMax, validCats: [], color: 'var(--accent-color)' },
        { id: 'core', name: coreLabel, target: coreTarget, validCats: [categories.PROGRAM_CORE], color: 'var(--cat-core)' },
        { id: 'majorcore', name: majorCoreLabel, target: majorCoreTarget, validCats: [categories.SOFTWARE_COMPULSORY], color: 'var(--cat-secore)' },
        { id: 'majorext', name: `${majorTitle} Extension`, target: majorExtensionTarget, validCats: [categories.SOFTWARE_EXTENSION], color: 'var(--cat-seext)' },
        { id: 'majoradvanced', name: `${majorTitle} Advanced Electives`, target: majorAdvancedTarget, validCats: [categories.SOFTWARE_ADVANCED], color: 'var(--cat-seext)' }
    ];

    if (minorId !== 'NONE') {
        reqs.push(
            { id: 'minorcore', name: `${minorTitle} Compulsory`, target: minorCompulsoryTarget, validCats: [categories.MINOR_COMPULSORY], color: 'var(--cat-aiminor)' },
            { id: 'minorelective', name: `${minorTitle} Electives`, target: minorElectiveTarget, validCats: [categories.MINOR_ELECTIVE], color: 'var(--cat-aiminor)' }
        );
    }

    const allocatedTargets = coreTarget + majorCoreTarget + majorExtensionTarget + majorAdvancedTarget
        + minorCompulsoryTarget + minorElectiveTarget;
    const electiveTarget = Math.max(0, beTotalMax - allocatedTargets);
    reqs.push({ id: 'electives', name: 'Other / Program Electives', target: electiveTarget, validCats: [categories.OTHER_ELECTIVE], color: 'var(--cat-elec)' });

    const semesters = [];
    const sy = parseInt(startYear, 10);
    for (let i = 0; i < yearsOfStudy; i++) {
        const yr = sy + i;
        const yy = yr.toString().slice(-2);
        semesters.push({ id: `sem-${yy}-1`, name: `${yr} Sem 1`, year: yr, semNum: 1 });
        semesters.push({ id: `sem-${yy}-2`, name: `${yr} Sem 2`, year: yr, semNum: 2 });
    }

    return {
        id: `${programId}_${majorId}_${minorId}_${rulesYear}_${startYear}`,
        title: `${majorTitle}${minorId !== 'NONE' ? ` (${minorTitle})` : ''}`,
        program: programId,
        major: majorId,
        minor: minorId,
        year: rulesYear,
        rulesYear: parseInt(rulesYear, 10),
        startYear: sy,
        programTitle: progData.title || "Bachelor of Engineering (Honours)",
        majorTitle: majorTitle,
        minorTitle: minorTitle,
        years: `${sy} to ${sy + (yearsOfStudy - 1)}`,
        semesters: semesters,
        requirements: reqs,
        courses: realCourses
    };
}
