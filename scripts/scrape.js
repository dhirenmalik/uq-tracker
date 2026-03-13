const https = require('https');
const fs = require('fs');
const path = require('path');

async function fetchUQData(url) {
    console.log(`Fetching ${url}...`);
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Status Code: ${res.statusCode} for ${url}`));
            }
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
    return text
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim() || null;
}

async function fetchCourseDetails(code) {
    const courseUrl = `https://programs-courses.uq.edu.au/course.html?course_code=${encodeURIComponent(code)}`;
    try {
        await delay(1000);
        const html = await fetchUQData(courseUrl);

        const prereqMatch = html.match(/<p[^>]*id=["']course-prerequisite["'][^>]*>([\s\S]*?)<\/p>/i);

        const prereqText = stripHtmlAndNormalize(prereqMatch ? prereqMatch[1] : null) || '';
        const prereqs = Array.from(new Set(prereqText.match(/[A-Z]{4}\d{4}/g) || []));

        return { prereqs };
    } catch (err) {
        console.warn(`Failed to fetch details for ${code}: ${err.message}`);
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
            existing = { code: code, name: ref.name, units: ref.unitsMaximum, cat: cat, exclusiveWith: [] };
            if (code === 'REIT4841' || code === 'REIT4842') existing.isYearLong = true;
            courses.push(existing);
            seenCodes.add(code);
        } else if (existing && cat && existing.cat !== cat) {
            // Overwrite category if a more specific one is found (e.g. AI Minor)
            // or if the categorization function prefers the new one
            if (cat === 'AI Minor') existing.cat = cat;
        }

        if (existing) {
            const excl = isExclusiveGroup ? groupCodes.filter(c => c !== code) : [];
            if (hardcodedExclusives[code]) {
                hardcodedExclusives[code].forEach(e => {
                    if (!excl.includes(e)) excl.push(e);
                });
            }
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
                const groupCodes = node.equivalenceGroup
                    .map(eg => eg.curriculumReference?.code)
                    .filter(Boolean);

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

    // Clean up empty exclusiveWith arrays
    courses.forEach(c => {
        if (c.exclusiveWith && c.exclusiveWith.length === 0) {
            delete c.exclusiveWith;
        }
    });
}

function updateRequirementsJs(key, reqs, content) {
    const reqsStr = reqs.map(r => {
        let str = `            { id: '${r.id}', name: '${r.name}', target: ${r.target}`;
        if (r.filterStr) str += `, filter: ${r.filterStr}`;
        if (r.color) str += `, color: '${r.color}'`;
        str += ` }`;
        return str;
    }).join(',\n');

    const searchStr = `${key}: {`;
    const degreeStart = content.indexOf(searchStr);
    if (degreeStart === -1) return content;

    const reqsArrayStart = content.indexOf('requirements: [', degreeStart);
    if (reqsArrayStart === -1) return content;

    const reqsArrayEnd = content.indexOf('        ],\n        courses:', reqsArrayStart);
    if (reqsArrayEnd === -1) return content;

    return content.substring(0, reqsArrayStart) +
        'requirements: [\n' + reqsStr + '\n' +
        content.substring(reqsArrayEnd);
}

function updateDataJs(key, courses, content) {
    const coursesStr = courses.map(c => {
        let str = `            { code: '${c.code}', name: '${c.name.replace(/'/g, "\\'")}', units: ${c.units}, cat: '${c.cat}'`;
        if (c.exclusiveWith) str += `, exclusiveWith: ${JSON.stringify(c.exclusiveWith)}`;
        if (c.isYearLong) str += `, isYearLong: true`;

        if (c.prereqs && c.prereqs.length > 0) str += `, prereqs: ${JSON.stringify(c.prereqs)}`;
        str += ` }`;
        return str;
    }).join(',\n');

    const searchStr = `${key}: {`;
    const degreeStart = content.indexOf(searchStr);
    if (degreeStart === -1) return content;

    const coursesArrayStart = content.indexOf('courses: [', degreeStart);
    if (coursesArrayStart === -1) return content;

    const coursesArrayEnd = content.indexOf('        ]\n    }', coursesArrayStart);
    if (coursesArrayEnd === -1) return content;

    return content.substring(0, coursesArrayStart) +
        'courses: [\n' + coursesStr + '\n' +
        content.substring(coursesArrayEnd);
}

// Helper to find the N parameter in a selection rule
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

async function main() {
    try {
        const YEAR = new Date().getFullYear();
        const urls = {
            se: `https://programs-courses.uq.edu.au/requirements/program/2455/${YEAR}`,
            ai: `https://programs-courses.uq.edu.au/requirements/plan/ARINTA2455/${YEAR}`
        };

        console.log('Fetching UQ data...');
        const [htmlSE, htmlAI] = await Promise.all([
            fetchUQData(urls.se),
            fetchUQData(urls.ai)
        ]);

        const seData = extractAppData(htmlSE);
        const aiData = extractAppData(htmlAI);

        // -------------------------------------------------------------
        // SE / AI MINOR
        // -------------------------------------------------------------
        const seCourses = [];
        const seenSE = new Set();

        const seProgRules = seData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload;
        const seBody = seProgRules.body;

        // 1. Process SE/Core Courses
        const corePart = seBody[0];
        const sePart = seBody.find(p => p.header?.title?.toLowerCase().includes('software engineering'));

        traverseAndExtract(corePart.body || [], seCourses, seenSE, () => 'Core');
        traverseAndExtract(sePart.body || [], seCourses, seenSE, (path) => {
            const s = path.toLowerCase();
            if (s.includes('extension course')) return 'SE Ext';
            if (s.includes('advanced elective')) return 'SE Adv';
            if (s.includes('breadth elective')) return 'Elective';
            return 'SE Core';
        });

        // 2. Process AI Minor Courses
        const aiProgRules = aiData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload;
        const aiBody = aiProgRules.body;
        traverseAndExtract(aiBody, seCourses, seenSE, () => 'AI Minor');

        // Add SE Placeholders
        const placeholders = [
            { code: 'ELEC_GEN_1', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_2', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_3', name: 'General/BE Elective', units: 2, cat: 'Elective' }
        ];
        seCourses.push(...placeholders);

        console.log(`Extracted ${seCourses.length} SE courses.`);

        const validCourseCodeRegex = /^[A-Z]{4}\d{4}$/;
        const existingCodes = new Set(seCourses.map(c => c.code));
        const realCourses = seCourses.filter(c => validCourseCodeRegex.test(c.code));

        for (let i = 0; i < realCourses.length; i++) {
            const course = realCourses[i];
            const details = await fetchCourseDetails(course.code);

            course.prereqs = (details.prereqs || []).filter(pr => existingCodes.has(pr));

            console.log(`Fetched details for ${course.code} (${i + 1}/${realCourses.length})`);
        }

        // Build Dynamic Requirements Array for SE
        const beTotalMax = seData.programRequirements.unitsMaximum || 64;
        const beCoreUnits = getRuleParamN(corePart);
        const beGenElecUnitsMax = getRuleParamM(seBody.find(p => p.header?.title === 'General Elective Courses'));

        // Sum the requirements inside the AI minor rules to get the total AI minor units (6 compulsory + 2 elective = 8)
        let aiMinorUnits = 0;
        aiBody.forEach(part => {
            aiMinorUnits += getRuleParamN(part);
        });

        // The overall SE minor requires 52 units, AI Minor requires 8, therefore SE rules total 44
        const seReqs = [
            { id: 'total', name: 'Total Units', target: beTotalMax, filterStr: '() => true', color: 'var(--accent-color)' },
            { id: 'core', name: 'BE Core', target: beCoreUnits, filterStr: "c => c.cat === 'Core'", color: 'var(--cat-core)' },
            { id: 'secore', name: 'SE Core', target: 34, filterStr: "c => c.cat === 'SE Core'", color: 'var(--cat-secore)' },
            { id: 'aiminor', name: 'AI Minor', target: aiMinorUnits, filterStr: "c => c.cat === 'AI Minor'", color: 'var(--cat-aiminor)' },
            { id: 'ext', name: 'SE Ext / Adv', target: 2, filterStr: "c => c.cat === 'SE Ext' || c.cat === 'SE Adv'", color: 'var(--cat-seext)' },
            { id: 'electives', name: 'Electives', target: beGenElecUnitsMax, filterStr: "c => c.cat === 'Elective'", color: 'var(--cat-elec)' },
        ];


        // -------------------------------------------------------------
        // UPDATE FILE
        // -------------------------------------------------------------
        const DATA_FILE = path.join(__dirname, '..', 'data.js');
        let content = fs.readFileSync(DATA_FILE, 'utf8');

        const filteredCourses = seCourses.filter(c => c.units <= 4);

        content = updateRequirementsJs('se_ai', seReqs, content);
        content = updateDataJs('se_ai', filteredCourses, content);

        fs.writeFileSync(DATA_FILE, content);
        console.log('Successfully updated data.js!');

    } catch (err) {
        console.error('Error running scraper:', err);
    }
}

main();
