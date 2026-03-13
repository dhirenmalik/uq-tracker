const https = require('https');
const fs = require('fs');
const path = require('path');

const YEAR = new Date().getFullYear();
const URL = `https://programs-courses.uq.edu.au/requirements/program/2455/${YEAR}`;
const DATA_FILE = path.join(__dirname, '..', 'data.js');

// Map UQ section names to our internal categories
function determineCategory(sectionPath) {
    const s = sectionPath.toLowerCase();
    if (s.includes('core courses')) return 'Core';

    if (s.includes('software engineering') || s.includes('software engineering plan options')) {
        if (s.includes('extension course')) return 'SE Ext';
        if (s.includes('advanced elective')) return 'SE Adv';
        if (s.includes('breadth elective')) return 'Elective';
        if (s.includes('minor options')) {
            // Need special handling for AI minor vs others, but for now we put them in sub-pools
            // if we can't tell, we'll assign it to a general category
        }
        return 'SE Core';
    }

    if (s.includes('program elective') || s.includes('general elective')) return 'Elective';
    return null; // Skip courses we don't care about
}

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

function updateDataJs(key, courses, content) {
    const coursesStr = courses.map(c => {
        let str = `            { code: '${c.code}', name: '${c.name.replace(/'/g, "\\'")}', units: ${c.units}, cat: '${c.cat}'`;
        if (c.exclusiveWith) str += `, exclusiveWith: ${JSON.stringify(c.exclusiveWith)}`;
        if (c.isYearLong) str += `, isYearLong: true`;
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

async function main() {
    try {
        const YEAR = new Date().getFullYear();
        const urls = {
            se: `https://programs-courses.uq.edu.au/requirements/program/2455/${YEAR}`,
            cs: `https://programs-courses.uq.edu.au/requirements/program/2451/${YEAR}`,
            ai: `https://programs-courses.uq.edu.au/requirements/plan/ARINTA2455/${YEAR}`
        };

        console.log('Fetching UQ data...');
        const [htmlSE, htmlCS, htmlAI] = await Promise.all([
            fetchUQData(urls.se),
            fetchUQData(urls.cs),
            fetchUQData(urls.ai)
        ]);

        const seData = extractAppData(htmlSE);
        const csData = extractAppData(htmlCS);
        const aiData = extractAppData(htmlAI);

        // 1. Process SE/Core Courses
        const seCourses = [];
        const seenSE = new Set();

        let seBody = seData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload.body;
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
        const aiBody = aiData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload.body;
        traverseAndExtract(aiBody, seCourses, seenSE, () => 'AI Minor');

        // Add SE Placeholders
        const placeholders = [
            { code: 'ELEC_GEN_1', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_2', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_3', name: 'General/BE Elective', units: 2, cat: 'Elective' }
        ];
        seCourses.push(...placeholders);

        // 3. Process CS Courses
        const csCourses = [];
        const seenCS = new Set();
        let csBody = csData.programRequirements.payload.components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES').payload.body;

        traverseAndExtract(csBody[0].body || [], csCourses, seenCS, () => 'CS Core');

        // Extract from "Plan Options" or "Elective Courses"
        for (let i = 1; i < csBody.length; i++) {
            const title = (csBody[i].header?.title || '').toLowerCase();
            if (title.includes('plan options') || title.includes('elective')) {
                traverseAndExtract(csBody[i].body || [], csCourses, seenCS, () => 'Elective');
            }
        }

        csCourses.push(
            { code: 'CS_ELEC_1', name: 'CS Elective 1', units: 2, cat: 'Elective' },
            { code: 'CS_ELEC_2', name: 'CS Elective 2', units: 2, cat: 'Elective' }
        );

        console.log(`Extracted ${seCourses.length} SE courses and ${csCourses.length} CS courses.`);

        const DATA_FILE = path.join(__dirname, '..', 'data.js');
        let content = fs.readFileSync(DATA_FILE, 'utf8');
        content = updateDataJs('se_ai', seCourses, content);
        content = updateDataJs('cs', csCourses, content);

        fs.writeFileSync(DATA_FILE, content);
        console.log('Successfully updated data.js!');

    } catch (err) {
        console.error('Error running scraper:', err);
    }
}

main();
