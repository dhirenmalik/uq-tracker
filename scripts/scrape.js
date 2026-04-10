const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPPORTED_PATHS = [
    {
        programId: '2455', programTitle: 'BE(Hons)',
        majorId: 'SOFTWE2455', majorTitle: 'Software Engineering',
        minorId: 'ARINTA2455', minorTitle: 'AI Minor',
        year: 2026
    },
    {
        programId: '2455', programTitle: 'BE(Hons)',
        majorId: 'SOFTWE2455', majorTitle: 'Software Engineering',
        minorId: 'CYBERA2455', minorTitle: 'Cyber Security Minor',
        year: 2026
    },
    {
        programId: '2455', programTitle: 'BE(Hons)',
        majorId: 'SOFTWE2455', majorTitle: 'Software Engineering',
        minorId: 'NONE', minorTitle: 'No Minor',
        year: 2026
    },
    {
        programId: '2455', programTitle: 'BE(Hons)',
        majorId: 'SOFTWE2455', majorTitle: 'Software Engineering',
        minorId: 'NONE', minorTitle: 'No Minor',
        year: 2024
    }
];

async function fetchUQData(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`Status Code: ${res.statusCode} for ${url}`));
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtmlAndNormalize(text) {
    if (!text) return null;
    return text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim() || null;
}

// Global cache for fetched course details to avoid redownloading common courses across multiple degrees
const cachedCourseDetails = {};

async function fetchCourseDetails(code) {
    if (cachedCourseDetails[code]) return cachedCourseDetails[code];

    const courseUrl = `https://programs-courses.uq.edu.au/course.html?course_code=${encodeURIComponent(code)}`;
    try {
        const html = await fetchUQData(courseUrl);
        const prereqMatch = html.match(/<p[^>]*id=["']course-prerequisite["'][^>]*>([\s\S]*?)<\/p>/i);
        const prereqText = stripHtmlAndNormalize(prereqMatch ? prereqMatch[1] : null) || '';
        const prereqs = Array.from(new Set(prereqText.match(/[A-Z]{4}\d{4}/g) || []));
        cachedCourseDetails[code] = { prereqs };
        return cachedCourseDetails[code];
    } catch (err) {
        return { prereqs: [] };
    }
}

function extractAppData(html) {
    const match = html.match(/window\.AppData\s*=\s*(\{.*?\});\s*<\/script>/s);
    if (!match) throw new Error('Could not find window.AppData in HTML');
    return JSON.parse(match[1]);
}

function traverseAndExtract(body, courses, seenCodes, determineCatFn) {
    const hardcodedExclusives = {
        'ENGG1001': ['CSSE1001'], 'CSSE1001': ['ENGG1001'],
        'MATH1051': ['MATH1071'], 'MATH1071': ['MATH1051'],
        'MATH1052': ['MATH1072'], 'MATH1072': ['MATH1052']
    };

    function processCourse(ref, sectionPath, isExclusiveGroup, groupCodes) {
        const code = ref.code;
        if (!code) return;

        let existing = courses.find(c => c.code === code);
        const cat = determineCatFn(sectionPath, code);

        if (!existing && cat) {
            existing = { code: code, name: ref.name || code, units: ref.unitsMaximum || 2, cat: cat };
            if (code === 'REIT4841' || code === 'REIT4842') existing.isYearLong = true;
            courses.push(existing);
            seenCodes.add(code);
            // Default exclusive array init to avoid undefined
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

    function traverse(node, sectionPath = '') {
        if (Array.isArray(node)) {
            for (const item of node) traverse(item, sectionPath);
        } else if (typeof node === 'object' && node !== null) {
            const rt = node.rowType;
            if (rt === 'CurriculumReference' && node.curriculumReference) {
                processCourse(node.curriculumReference, sectionPath, false, []);
            } else if (rt === 'EquivalenceGroup' && Array.isArray(node.equivalenceGroup)) {
                const groupCodes = node.equivalenceGroup.map(eg => eg.curriculumReference?.code).filter(Boolean);
                for (const eg of node.equivalenceGroup) {
                    if (eg.curriculumReference) {
                        processCourse(eg.curriculumReference, sectionPath, true, groupCodes);
                    }
                }
            } else if (node.header?.title) {
                const title = node.header.title;
                const nextPath = sectionPath ? `${sectionPath} > ${title}` : title;
                if (Array.isArray(node.body)) traverse(node.body, nextPath);
            } else if (Array.isArray(node.body)) {
                traverse(node.body, sectionPath);
            }
        }
    }
    traverse(body);

    courses.forEach(c => {
        if (c.exclusiveWith && c.exclusiveWith.length === 0) delete c.exclusiveWith;
    });
}

function getRuleParamN(part) {
    if (!part || !part.header || !part.header.selectionRule) return 0;
    const params = part.header.selectionRule.params || [];
    const nParam = params.find(p => p.name === 'N');
    return nParam ? nParam.value : 0;
}

function getRuleParamM(part) {
    if (!part || !part.header || !part.header.selectionRule) return 0;
    const params = part.header.selectionRule.params || [];
    const mParam = params.find(p => p.name === 'M');
    return mParam ? mParam.value : 0;
}

async function scrapeDegree(config) {
    console.log(`\nscraping: ${config.programTitle} - ${config.majorTitle} - ${config.minorTitle} (${config.year})`);

    // Build URLs
    const urls = {
        prog: `https://programs-courses.uq.edu.au/requirements/program/${config.programId}/${config.year}`,
        plan: config.majorId !== 'NONE' ? `https://programs-courses.uq.edu.au/requirements/plan/${config.majorId}/${config.year}` : null,
        minor: config.minorId !== 'NONE' ? `https://programs-courses.uq.edu.au/requirements/plan/${config.minorId}/${config.year}` : null
    };

    let progHtml, planHtml, minorHtml;
    try {
        progHtml = await fetchUQData(urls.prog);
        if (urls.plan) planHtml = await fetchUQData(urls.plan);
        if (urls.minor) minorHtml = await fetchUQData(urls.minor);
    } catch (e) {
        console.warn(`=> Skipped due to API error (likely doesn't exist for ${config.year}): ${e.message}`);
        return null; // Return null if degree path doesn't exist
    }

    let progData, planData, minorData;
    try {
        progData = extractAppData(progHtml);
        planData = urls.plan ? extractAppData(planHtml) : null;
        minorData = urls.minor ? extractAppData(minorHtml) : null;
    } catch (e) {
        console.warn(`=> Skipped due to invalid AppData (likely doesn't exist for ${config.year}): ${e.message}`);
        return null;
    }

    const courses = [];
    const seen = new Set();

    // Scrape Prog
    const progRules = progData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload;
    const progBody = progRules.body;

    const corePart = progBody[0];
    const optionPart = progBody.find(p => p.header?.title?.toLowerCase().includes('option')); // Generic option finder

    // Core
    if (corePart) traverseAndExtract(corePart.body || [], courses, seen, () => 'Core');

    // Plan (Major) Option
    if (optionPart) {
        traverseAndExtract(optionPart.body || [], courses, seen, (path) => {
            const s = path.toLowerCase();
            if (s.includes('extension') || s.includes('research')) return 'Major Ext';
            if (s.includes('advanced')) return 'Major Adv';
            if (s.includes('elective')) return 'Elective';
            return 'Major Options';
        });
    }

    // Scrape Major explicit compulsory
    if (planData) {
        const planRules = planData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload;
        const majorCorePart = planRules.body.find(p => p.header?.title?.toLowerCase().includes('compulsory'));
        if (majorCorePart) {
            traverseAndExtract(majorCorePart.body || [], courses, seen, () => 'Major Core');
        }
    }

    // Scrape Minor
    let minorUnits = 0;
    if (minorData) {
        const minorRules = minorData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload;
        minorRules.body.forEach(part => minorUnits += getRuleParamN(part));
        traverseAndExtract(minorRules.body, courses, seen, () => 'Minor');
    }

    // Add Elective Placeholders
    courses.push(
        { code: 'ELEC_GEN_1', name: 'General/BE Elective', units: 2, cat: 'Elective' },
        { code: 'ELEC_GEN_2', name: 'General/BE Elective', units: 2, cat: 'Elective' },
        { code: 'ELEC_GEN_3', name: 'General/BE Elective', units: 2, cat: 'Elective' }
    );

    // Fetch Details
    const validCourseCodeRegex = /^[A-Z]{4}\d{4}$/;
    const existingCodes = new Set(courses.map(c => c.code));
    const realCourses = courses.filter(c => validCourseCodeRegex.test(c.code) && c.units <= 4);

    for (let i = 0; i < realCourses.length; i++) {
        const details = await fetchCourseDetails(realCourses[i].code);
        realCourses[i].prereqs = (details.prereqs || []).filter(pr => existingCodes.has(pr));
    }

    // Build Req list
    const beTotalMax = progData.programRequirements.unitsMaximum || 64;
    const beCoreUnits = corePart ? getRuleParamN(corePart) : 8;
    const beGenElecUnitsMax = optionPart ? getRuleParamM(optionPart.body?.find(p => p.header?.title === 'General Elective Courses')) : 4;

    const majorCoreUnits = 34; // Dynamic extracting is tricky relying on plan specifics, using safe anchor

    // Generate 4-year (8 semesters) layout array for UI
    const semesters = [];
    const sy = parseInt(config.year, 10);
    for (let i = 0; i < 4; i++) {
        const yr = sy + i;
        const yy = yr.toString().slice(-2);
        semesters.push({ id: `sem-${yy}-1`, name: `${yr} Sem 1`, year: yr, semNum: 1 });
        semesters.push({ id: `sem-${yy}-2`, name: `${yr} Sem 2`, year: yr, semNum: 2 });
    }

    const reqs = [
        { id: 'total', name: 'Total Units', target: beTotalMax, filterStr: '() => true', color: 'var(--accent-color)' },
        { id: 'core', name: 'BE Core', target: beCoreUnits, filterStr: "c => c.cat === 'Core'", color: 'var(--cat-core)' },
        { id: 'majorcore', name: 'SE Core', target: majorCoreUnits, filterStr: "c => c.cat === 'Major Core'", color: 'var(--cat-secore)' }
    ];

    if (config.minorId !== 'NONE') {
        reqs.push({ id: 'minor', name: config.minorTitle, target: minorUnits, filterStr: "c => c.cat === 'Minor'", color: 'var(--cat-aiminor)' });
    }

    reqs.push(
        { id: 'majorext', name: 'SE Ext / Adv', target: 2, filterStr: "c => c.cat === 'Major Ext' || c.cat === 'Major Adv'", color: 'var(--cat-seext)' },
        { id: 'electives', name: 'Electives', target: beGenElecUnitsMax || 4, filterStr: "c => c.cat === 'Elective' || c.cat === 'Major Options'", color: 'var(--cat-elec)' }
    );

    return {
        id: `${config.programId}_${config.majorId}_${config.minorId}_${config.year}`,
        title: `${config.majorTitle} (${config.minorTitle})`,
        program: config.programId,
        major: config.majorId,
        minor: config.minorId,
        year: config.year,
        programTitle: config.programTitle,
        majorTitle: config.majorTitle,
        minorTitle: config.minorTitle,
        years: `${sy} to ${sy + 3}`,
        semesters: semesters,
        requirements: reqs,
        courses: realCourses
    };
}

async function main() {
    try {
        console.log('Starting Batch Scrape...');
        const finalData = {};

        for (const config of SUPPORTED_PATHS) {
            const res = await scrapeDegree(config);
            if (res) finalData[res.id] = res;
        }

        const dataJsPath = path.join(__dirname, '..', 'data.js');

        // Preserve existing UQ_OPTIONS from the current data.js
        let existingUqOptions = '';
        try {
            const existingContent = fs.readFileSync(dataJsPath, 'utf8');
            const uqOptionsMatch = existingContent.match(/const UQ_OPTIONS\s*=\s*(\{[\s\S]*?\n\});/);
            if (uqOptionsMatch) {
                existingUqOptions = uqOptionsMatch[0];
            }
        } catch (e) {
            console.warn('Could not read existing data.js for UQ_OPTIONS:', e.message);
        }

        // Convert the filterStr representations back into raw functions during stringify
        const jsonStr = JSON.stringify(finalData, null, 4).replace(/"filterStr":\s*"([^"]+)"/g, (match, fnStr) => {
            return `"filter": ${fnStr.replace(/\\"/g, '"')}`;
        });

        let output = '';
        if (existingUqOptions) {
            output += `// Automatically scraped UQ Structure Directory\n`;
            output += `// Covers all UG/PG Programs -> Majors -> Bound Minors.\n\n`;
            output += existingUqOptions + '\n\n';
        }
        output += `let DEGREES = ${jsonStr};\n`;

        fs.writeFileSync(dataJsPath, output);

        console.log('Successfully wrote data.js!');
    } catch (err) {
        console.error('Error:', err);
    }
}

main();
