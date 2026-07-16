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
        courseCache[code] = { name: code, prereqs: [], prereqOptions: [], semesters: {} };
        return courseCache[code];
    }
    const prereqMatch = html.match(/<p[^>]*id=["']course-prerequisite["'][^>]*>([\s\S]*?)<\/p>/i);
    const prereqText = stripHtmlAndNormalize(prereqMatch ? prereqMatch[1] : null) || '';
    const prereqs = Array.from(new Set(prereqText.match(/[A-Z]{4}\d{4}/g) || []));
    const prereqOptions = DegreeRules.prerequisiteExpressionToOptions(prereqText);
    const courseName = stripHtmlAndNormalize(
        html.match(/id=["']course-title["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]
        || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
    )?.replace(/\s*-\s*my\.UQ.*$/i, '').replace(new RegExp(`\\s*\\(${code}\\)\\s*$`, 'i'), '') || code;

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

    courseCache[code] = { name: courseName, prereqs, prereqOptions, semesters };
    return courseCache[code];
}

async function scrapeLiveDegree(
    majorTitle,
    programId,
    majorId,
    minorId,
    minorTitle,
    rulesYear,
    startYear = rulesYear,
    summerYears = [],
    secondMajorId = 'NONE',
    secondMajorTitle = 'No Second Major'
) {
    const requestedRulesYear = parseInt(rulesYear, 10);
    const effectiveProgramId = DegreeRules.resolveProgramId(programId, requestedRulesYear);
    const candidateRulesYears = UQ_OPTIONS.years
        .map(Number)
        .filter(year => year >= requestedRulesYear && year <= requestedRulesYear + 2)
        .sort((a, b) => a - b);

    let effectiveRulesYear = requestedRulesYear;
    let progData = null;
    for (const candidateYear of candidateRulesYears) {
        const progUrl = `https://programs-courses.uq.edu.au/requirements/program/${effectiveProgramId}/${candidateYear}`;
        progData = extractAppData(await fetchUQRaw(progUrl));
        if (progData) {
            effectiveRulesYear = candidateYear;
            break;
        }
    }

    if (!progData) {
        throw new Error(`UQ does not publish requirements for this program from ${requestedRulesYear} to ${requestedRulesYear + 2}.`);
    }

    const programRuleJson = JSON.stringify(progData.programRequirements || {});
    const availablePlanIds = [...new Set(programRuleJson.match(/[A-Z]{5,}\d{4}/g) || [])];
    const effectiveMajorId = DegreeRules.resolvePlanId(majorId, availablePlanIds);
    const effectiveSecondMajorId = DegreeRules.resolvePlanId(secondMajorId, availablePlanIds);
    const effectiveMinorId = DegreeRules.resolvePlanId(minorId, availablePlanIds);
    const planUrl = effectiveMajorId !== 'NONE'
        ? `https://programs-courses.uq.edu.au/requirements/plan/${effectiveMajorId}/${effectiveRulesYear}`
        : null;
    const minorUrl = effectiveMinorId !== 'NONE'
        ? `https://programs-courses.uq.edu.au/requirements/plan/${effectiveMinorId}/${effectiveRulesYear}`
        : null;
    const secondPlanUrl = effectiveSecondMajorId !== 'NONE'
        ? `https://programs-courses.uq.edu.au/requirements/plan/${effectiveSecondMajorId}/${effectiveRulesYear}`
        : null;
    const [planData, secondPlanData, minorData] = await Promise.all([
        planUrl ? fetchUQRaw(planUrl).then(extractAppData) : null,
        secondPlanUrl ? fetchUQRaw(secondPlanUrl).then(extractAppData) : null,
        minorUrl ? fetchUQRaw(minorUrl).then(extractAppData) : null
    ]);

    if (planUrl && !planData) {
        throw new Error(`The major ${majorTitle} (${effectiveMajorId}) does not seem to exist or be offered for this program in ${effectiveRulesYear}.`);
    }

    if (minorUrl && !minorData) {
        throw new Error(`The minor ${minorTitle} (${effectiveMinorId}) does not seem to exist or be offered for this program in ${effectiveRulesYear}.`);
    }
    if (secondPlanUrl && !secondPlanData) {
        throw new Error(`The second major ${secondMajorTitle} (${effectiveSecondMajorId}) does not seem to exist in ${effectiveRulesYear}.`);
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
    const ruleContext = { rulesYear: effectiveRulesYear, majorId, minorId };
    let coreLabel = "BE Core";
    let coreTarget = 0;
    let programElectiveTarget = 0;
    let majorCoreLabel = `${majorTitle} Compulsory`;
    let majorCoreTarget = 0;
    let majorElectiveTarget = 0;
    let secondMajorCoreTarget = 0;
    let secondMajorElectiveTarget = 0;
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
        const selectedOptionsPart = progRules.body.find(part => part.header?.title === selectedOptionsTitle);

        if (!selectedOptionsPart) {
            coreLabel = 'Program Core';
            function collectNestedTargets(node) {
                if (Array.isArray(node)) {
                    node.forEach(collectNestedTargets);
                    return;
                }
                if (!node || typeof node !== 'object') return;
                const title = node.header?.title?.toLowerCase() || '';
                const n = getRuleN(node);
                if (n > 0 && title.includes('core')) coreTarget += n;
                if (n > 0 && title.includes('elective')) programElectiveTarget += n;
                collectNestedTargets(node.body);
            }
            collectNestedTargets(progRules.body);
            traverseTree(progRules.body, path => {
                const s = path.toLowerCase();
                if (s.includes('major list') || s.includes('minor list')) return null;
                if (s.includes('core')) return categories.PROGRAM_CORE;
                if (s.includes('elective')) return categories.PROGRAM_ELECTIVE;
                return null;
            });
        }

        progRules.body.forEach((part, idx) => {
            const title = part.header?.title || '';
            const lTitle = title.toLowerCase();
            const n = getRuleN(part);

            if (selectedOptionsPart && (idx === 0 || lTitle.includes('core'))) {
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
                    if (majorId !== 'SOFTWE2455') majorElectiveTarget += n;
                    traverseTree(part.body || [], () =>
                        majorId === 'SOFTWE2455' ? categories.OTHER_ELECTIVE : categories.MAJOR_ELECTIVE
                    );
                }
            });
        }
    }

    if (secondPlanData) {
        const secondPlanRules = secondPlanData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES')?.payload;
        if (secondPlanRules) {
            secondPlanRules.body.forEach(part => {
                const title = part.header?.title || '';
                const lTitle = title.toLowerCase();
                const n = getRuleN(part);
                if (lTitle.includes('compulsory') || lTitle.includes('core')) {
                    secondMajorCoreTarget += n;
                    traverseTree(part.body || [], () => categories.SECOND_MAJOR_COMPULSORY);
                } else if (lTitle.includes('elective')) {
                    secondMajorElectiveTarget += n;
                    traverseTree(part.body || [], () => categories.SECOND_MAJOR_ELECTIVE);
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

    if (effectiveProgramId === '2451' && planData) {
        programElectiveTarget = 0;
    }

    const sharedCompulsoryUnits = courses
        .filter(course =>
            course.sourceCategories.includes(categories.SOFTWARE_COMPULSORY)
            && course.sourceCategories.includes(categories.SECOND_MAJOR_COMPULSORY)
        )
        .reduce((sum, course) => sum + course.units, 0);
    secondMajorCoreTarget = Math.max(0, secondMajorCoreTarget - sharedCompulsoryUnits);

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

    const isLegacyEngineeringComputerScienceComputerEngineering =
        effectiveProgramId === '2489' && effectiveMajorId === 'COMPEC2455';
    if (isLegacyEngineeringComputerScienceComputerEngineering) {
        const supplementalCodes = [
            'ENGG1300', 'ENGG1700', 'ELEC2004', 'MATH2010', 'STAT2201',
            'MECH2100', 'MECH2300', 'METR2800', 'METR4201', 'METR4810',
            'ELEC3004', 'MECH3200', 'MATH2301', 'MATH2302', 'MATH3306'
        ];
        supplementalCodes.forEach(code => {
            if (!courses.some(course => course.code === code)) {
                courses.push({
                    code,
                    name: code,
                    units: 2,
                    cat: categories.OTHER_ELECTIVE,
                    isSupplemental: true
                });
            }
        });
    }

    const validCourseCodeRegex = /^[A-Z]{4}\d{4}$/;
    const realCourses = courses.filter(c => validCourseCodeRegex.test(c.code) && c.units <= 4);

    // Fetch course details and recursively include prerequisite-chain courses so
    // they can be planned and validated even when they are not in a degree list.
    const courseByCode = new Map(realCourses.map(course => [course.code, course]));
    const queue = realCourses.map(course => course.code);
    const fetched = new Set();
    const MAX_CATALOG_COURSES = 300;
    let completed = 0;

    while (queue.length > 0 && courseByCode.size < MAX_CATALOG_COURSES) {
        const batch = queue.splice(0, 20).filter(code => !fetched.has(code));
        if (batch.length === 0) continue;
        const detailsBatch = await Promise.all(batch.map(code => scrapeCourseDetailsDynamically(code)));

        batch.forEach((code, index) => {
            fetched.add(code);
            completed += 1;
            const details = detailsBatch[index] || {};
            const course = courseByCode.get(code);
            if (!course) return;
            course.prereqs = details.prereqs || [];
            course.prereqOptions = details.prereqOptions || [];
            if (details.semesters && Object.keys(details.semesters).length > 0) {
                course.semesters = details.semesters;
            }

            (details.prereqs || []).forEach(prereqCode => {
                if (!validCourseCodeRegex.test(prereqCode) || courseByCode.has(prereqCode)) return;
                const prerequisiteCourse = {
                    code: prereqCode,
                    name: prereqCode,
                    units: 2,
                    cat: categories.OTHER_ELECTIVE,
                    isPrerequisiteOnly: true
                };
                courseByCode.set(prereqCode, prerequisiteCourse);
                realCourses.push(prerequisiteCourse);
                queue.push(prereqCode);
            });
            if (window.updateScraperProgress) {
                window.updateScraperProgress(completed, Math.max(completed, fetched.size + queue.length));
            }
        });
    }

    for (const course of realCourses) {
        const details = courseCache[course.code];
        if ((course.isPrerequisiteOnly || course.isSupplemental) && details?.name) course.name = details.name;
    }

    // FORMAT UI OUTPUT
    const beTotalMax = progData.programRequirements?.unitsMaximum || progData.programRequirements?.unitsMinimum || 48;
    const yearsOfStudy = Math.ceil(beTotalMax / 16);

    const reqs = [
        { id: 'total', name: 'Total Units', target: beTotalMax, validCats: [], color: 'var(--accent-color)' },
        { id: 'core', name: coreLabel, target: coreTarget, validCats: [categories.PROGRAM_CORE], color: 'var(--cat-core)' },
        { id: 'majorcore', name: majorCoreLabel, target: majorCoreTarget, validCats: [categories.SOFTWARE_COMPULSORY], color: 'var(--cat-secore)' }
    ];

    if (majorExtensionTarget > 0) {
        reqs.push({ id: 'majorext', name: `${majorTitle} Extension`, target: majorExtensionTarget, validCats: [categories.SOFTWARE_EXTENSION], color: 'var(--cat-seext)' });
    }
    if (majorAdvancedTarget > 0) {
        reqs.push({ id: 'majoradvanced', name: `${majorTitle} Advanced Electives`, target: majorAdvancedTarget, validCats: [categories.SOFTWARE_ADVANCED], color: 'var(--cat-seext)' });
    }

    if (programElectiveTarget > 0) {
        reqs.push({ id: 'programelectives', name: 'Program Electives', target: programElectiveTarget, validCats: [categories.PROGRAM_ELECTIVE], color: 'var(--cat-elec)' });
    }
    if (majorElectiveTarget > 0) {
        reqs.push({ id: 'majorelectives', name: `${majorTitle} Electives`, target: majorElectiveTarget, validCats: [categories.MAJOR_ELECTIVE], color: 'var(--cat-seext)' });
    }
    if (secondMajorId !== 'NONE') {
        if (secondMajorCoreTarget > 0) {
            reqs.push({
                id: 'secondmajorcore',
                name: `${secondMajorTitle} Compulsory`,
                target: secondMajorCoreTarget,
                validCats: [categories.SECOND_MAJOR_COMPULSORY],
                color: 'var(--cat-secore)'
            });
        }
        if (secondMajorElectiveTarget > 0) {
            reqs.push({
                id: 'secondmajorelectives',
                name: `${secondMajorTitle} Electives`,
                target: secondMajorElectiveTarget,
                validCats: [categories.SECOND_MAJOR_ELECTIVE],
                color: 'var(--cat-seext)'
            });
        }
    }

    if (minorId !== 'NONE') {
        reqs.push(
            { id: 'minorcore', name: `${minorTitle} Compulsory`, target: minorCompulsoryTarget, validCats: [categories.MINOR_COMPULSORY], color: 'var(--cat-aiminor)' },
            { id: 'minorelective', name: `${minorTitle} Electives`, target: minorElectiveTarget, validCats: [categories.MINOR_ELECTIVE], color: 'var(--cat-aiminor)' }
        );
    }

    const allocatedTargets = coreTarget + programElectiveTarget + majorCoreTarget + majorElectiveTarget
        + secondMajorCoreTarget + secondMajorElectiveTarget + majorExtensionTarget + majorAdvancedTarget
        + minorCompulsoryTarget + minorElectiveTarget;
    const electiveTarget = Math.max(0, beTotalMax - allocatedTargets);
    reqs.push({ id: 'electives', name: 'Other / Program Electives', target: electiveTarget, validCats: [categories.OTHER_ELECTIVE], color: 'var(--cat-elec)' });

    const sy = parseInt(startYear, 10);
    const selectedSummerYears = summerYears
        .map(Number)
        .filter(year => DegreeRules.getStudyYears(sy, yearsOfStudy).includes(year));
    const semesters = DegreeRules.buildSemesters(sy, yearsOfStudy, selectedSummerYears);
    const summerIdSuffix = selectedSummerYears.length > 0
        ? `_summer-${selectedSummerYears.join('-')}`
        : '';

    const secondMajorIdSuffix = secondMajorId !== 'NONE' ? `_second-${secondMajorId}` : '';

    return {
        id: `${programId}_${majorId}_${minorId}_${effectiveRulesYear}_${startYear}${secondMajorIdSuffix}${summerIdSuffix}`,
        title: `${majorTitle}${secondMajorId !== 'NONE' ? ` + ${secondMajorTitle}` : ''}${minorId !== 'NONE' ? ` (${minorTitle})` : ''}`,
        program: programId,
        major: majorId,
        secondMajor: secondMajorId,
        minor: minorId,
        year: effectiveRulesYear,
        rulesYear: effectiveRulesYear,
        requestedRulesYear,
        startYear: sy,
        summerYears: selectedSummerYears,
        programTitle: progData.title || "Bachelor of Engineering (Honours)",
        majorTitle: majorTitle,
        secondMajorTitle,
        minorTitle: minorTitle,
        years: `${sy} to ${sy + (yearsOfStudy - 1)}`,
        semesters: semesters,
        requirements: reqs,
        courses: realCourses
    };
}
