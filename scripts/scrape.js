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

async function fetchUQData() {
    console.log(`Fetching ${URL}...`);
    return new Promise((resolve, reject) => {
        https.get(URL, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Status Code: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function extractCourses(html) {
    console.log('Extracting window.AppData...');
    const match = html.match(/window\.AppData\s*=\s*(\{.*?\});\s*<\/script>/s);
    if (!match) throw new Error('Could not find window.AppData in HTML');

    const data = JSON.parse(match[1]);
    const components = data.programRequirements.payload.components;
    const progRules = components.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES');
    const body = progRules.payload.body;

    const courses = [];
    const seenCodes = new Set();
    const hardcodedExclusives = {
        'ENGG1001': ['CSSE1001'], 'CSSE1001': ['ENGG1001'],
        'MATH1051': ['MATH1071'], 'MATH1071': ['MATH1051'],
        'MATH1052': ['MATH1072'], 'MATH1072': ['MATH1052']
    };

    function processCourse(ref, sectionPath, isExclusiveGroup, groupCodes) {
        const code = ref.code;
        if (!code) return;

        let existing = courses.find(c => c.code === code);

        const cat = determineCategory(sectionPath);
        if (!cat) return; // Skip non-SE/Core courses

        if (!existing) {
            existing = {
                code: code,
                name: ref.name,
                units: ref.unitsMaximum,
                cat: cat,
                exclusiveWith: []
            };
            // REIT4841/2 are year long
            if (code === 'REIT4841' || code === 'REIT4842') {
                existing.isYearLong = true;
            }
            courses.push(existing);
            seenCodes.add(code);
        }

        // Add mutually exclusive info if in an equivalence group
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
                if (Array.isArray(node.body)) {
                    traverse(node.body, nextPath);
                }
            } else if (Array.isArray(node.body)) {
                traverse(node.body, sectionPath);
            }
        }
    }

    // We only care about BE Core (0) and SE Plan Options (6)
    const corePart = body[0];
    const sePart = body.find(p => p.header?.title?.toLowerCase().includes('software engineering'));

    if (corePart) traverse(corePart.body || [], corePart.header?.title || 'Core');
    if (sePart) traverse(sePart.body || [], sePart.header?.title || 'SE');

    // Clean up empty exclusiveWith arrays
    courses.forEach(c => {
        if (c.exclusiveWith && c.exclusiveWith.length === 0) {
            delete c.exclusiveWith;
        }
    });

    return courses;
}

function updateDataJs(courses) {
    console.log(`Updating data.js with ${courses.length} courses...`);
    let content = fs.readFileSync(DATA_FILE, 'utf8');

    // We want to replace the `courses: [ ... ]` array for the `se_ai` degree
    const coursesStr = courses.map(c => {
        let str = `            { code: '${c.code}', name: '${c.name.replace(/'/g, "\\'")}', units: ${c.units}, cat: '${c.cat}'`;
        if (c.exclusiveWith) str += `, exclusiveWith: ${JSON.stringify(c.exclusiveWith)}`;
        if (c.isYearLong) str += `, isYearLong: true`;
        str += ` }`;
        return str;
    }).join(',\n');

    const replacement = `courses: [\n${coursesStr}\n        ]`;

    // Regex to match the courses array inside the se_ai degree definition
    // It's a bit fragile using pure regex, so we'll do a simple string replacement
    const parts = content.split(/courses:\s*\[/);
    if (parts.length >= 2) {
        // Find the end of the first courses array (`se_ai` degree)
        const endIdx = parts[1].indexOf('        ]\n    },');
        if (endIdx !== -1) {
            const updated = parts[0] + 'courses: [\n' + coursesStr + '\n' + parts[1].substring(endIdx);
            fs.writeFileSync(DATA_FILE, updated);
            console.log('Successfully updated data.js!');
            return;
        }
    }
    console.error('Failed to parse data.js structure for replacement.');
}

async function main() {
    try {
        const html = await fetchUQData();
        const courses = extractCourses(html);

        // Add manual AI minor and placeholder courses to the extracted list
        const manualCourses = [
            // AI Minor specific courses that might not be easily parsed from the tree structure
            { code: 'COMP3702', name: 'Artificial Intelligence', units: 2, cat: 'AI Minor' },
            { code: 'COMP4702', name: 'Machine Learning', units: 2, cat: 'AI Minor' },
            { code: 'COMP3710', name: 'Pattern Recognition and Analysis', units: 2, cat: 'AI Minor' },
            { code: 'COMP4703', name: 'Natural Language Processing', units: 2, cat: 'AI Minor' },
            { code: 'DECO2801', name: 'Human-Centred AI', units: 2, cat: 'AI Minor' },
            { code: 'ELEC4630', name: 'Computer Vision and Deep Learning', units: 2, cat: 'AI Minor' },
            { code: 'STAT3006', name: 'Statistical Learning', units: 2, cat: 'AI Minor' },
            { code: 'STAT3007', name: 'Deep Learning', units: 2, cat: 'AI Minor' },

            // Placeholders
            { code: 'ELEC_GEN_1', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_2', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_3', name: 'General/BE Elective', units: 2, cat: 'Elective' }
        ];

        // Map the existing AI courses to 'AI Minor' category if they exist in the extracted list
        const aiCodes = manualCourses.filter(c => c.cat === 'AI Minor').map(c => c.code);
        courses.forEach(c => {
            if (aiCodes.includes(c.code)) c.cat = 'AI Minor';
            // Explicitly classify Generative AI as SE Core based on the existing tracker data
            if (c.code === 'COMP2701') c.cat = 'SE Core';
        });

        // Add placeholders
        manualCourses.filter(c => c.cat === 'Elective').forEach(c => courses.push(c));

        updateDataJs(courses);
    } catch (err) {
        console.error('Error running scraper:', err.message);
    }
}

main();
