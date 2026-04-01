const https = require('https');
const fs = require('fs');

async function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const loc = res.headers.location;
                const newUrl = loc.startsWith('http') ? loc : 'https://programs-courses.uq.edu.au' + (loc.startsWith('/') ? '' : '/') + loc;
                return resolve(fetchHtml(newUrl));
            }
            if (res.statusCode !== 200) return reject(new Error('Status ' + res.statusCode));
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function stripTags(html) {
    return html.replace(/<[^>]*>?/gm, '').trim();
}

async function run() {
    console.log("Fetching Undergrad Index...");
    const indexHtml = await fetchHtml('https://programs-courses.uq.edu.au/browse.html?level=ugpg');
    
    // Extract Programs
    const progRegex = /href="[^"]*acad_prog=(\d{4})"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const programsMap = new Map();
    while ((match = progRegex.exec(indexHtml)) !== null) {
        const id = match[1];
        const label = stripTags(match[2]).replace(/\s+/g, ' ').trim();
        if (!programsMap.has(id) && label) {
            programsMap.set(id, label);
        }
    }

    const programs = Array.from(programsMap.entries()).map(([id, label]) => ({ id, label }));
    console.log(`Found ${programs.length} programs. Scraping their nested rules trees...`);

    const UQ_OPTIONS = {
        programs: programs,
        majors: {},
        minors: {},
        years: [2024, 2025, 2026]
    };

    const CONCURRENCY = 10;
    let index = 0;

    async function worker() {
        while (true) {
            const i = index++;
            if (i >= programs.length) return;
            const prog = programs[i];
            
            try {
                // Step 1: Parse string labels from the Program page
                const html = await fetchHtml(`https://programs-courses.uq.edu.au/program.html?acad_prog=${prog.id}`);
                const planRegex = /<a[^>]*href="[^"]*acad_plan=([A-Z0-9]+)"[^>]*>(.*?)<\/a>/gi;
                
                let pMatch;
                const majorsObj = {};
                const minorsObj = {};
                
                while ((pMatch = planRegex.exec(html)) !== null) {
                    const planId = pMatch[1];
                    const label = stripTags(pMatch[2]).trim();
                    const lowerLabel = label.toLowerCase();
                    
                    if (lowerLabel.includes('minor') && !lowerLabel.includes('schedule') && !lowerLabel.includes('rules')) {
                        minorsObj[planId] = { id: planId, label: label };
                    } else if (!lowerLabel.includes('schedule') && !lowerLabel.includes('rules')) {
                        majorsObj[planId] = { id: planId, label: label };
                    }
                }

                const majorsList = Object.values(majorsObj);
                const minorsList = Object.values(minorsObj);
                
                if (majorsList.length === 0) majorsList.push({ id: 'NONE', label: 'No Major' });
                UQ_OPTIONS.majors[prog.id] = majorsList;

                // Step 2: Extract nested bounding structure from JSON tree
                const reqHtml = await fetchHtml(`https://programs-courses.uq.edu.au/requirements/program/${prog.id}/2026`);
                const appDataMatch = reqHtml.match(/window\.AppData\s*=\s*(\{.*?\});\s*<\/script>/s);
                
                let rulesMap = {}; // majorId -> Set of minorIds
                majorsList.forEach(m => rulesMap[m.id] = new Set());
                
                if (appDataMatch && minorsList.length > 0) {
                    const appData = JSON.parse(appDataMatch[1]);
                    const comps = appData.programRequirements?.payload?.components || [];
                    const pr = comps.find(c => c.componentIntegrationIdentifier === 'PROGRAM_RULES');
                    
                    if (pr && pr.payload && Array.isArray(pr.payload.body)) {
                        const mSet = new Set(Object.keys(majorsObj));
                        const miSet = new Set(Object.keys(minorsObj));
                        
                        pr.payload.body.forEach(b => {
                            let mFound = new Set(), miFound = new Set();
                            function getCodes(n) {
                                if (!n) return;
                                if (n.code && mSet.has(n.code)) mFound.add(n.code);
                                if (n.code && miSet.has(n.code)) miFound.add(nodeCodeFix(n.code));
                                if (typeof n === 'object') Object.values(n).forEach(getCodes);
                            }
                            function nodeCodeFix(code) { return code; }
                            getCodes(b);
                            
                            // Cross-bind all majors and minors that officially share a UQ requirement block
                            mFound.forEach(major => {
                                miFound.forEach(minor => {
                                    rulesMap[major].add(minor);
                                });
                            });
                        });
                    }
                }
                
                // Finalize Minors assignments to specifically bound majors
                if (minorsList.length > 0) {
                    if (majorsList.length === 1 && majorsList[0].id === 'NONE') {
                        // Inherit to program level if no majors exist
                        UQ_OPTIONS.minors[prog.id] = [{ id: 'NONE', label: 'No Minor' }, ...minorsList];
                    } else {
                        // Apply specific bindings
                        majorsList.forEach(m => {
                            if (m.id !== 'NONE') {
                                const specificMinors = Array.from(rulesMap[m.id] || []).map(miId => minorsObj[miId]).filter(x => x);
                                if (specificMinors.length > 0) {
                                    UQ_OPTIONS.minors[m.id] = [{ id: 'NONE', label: 'No Minor' }, ...specificMinors];
                                }
                            }
                        });
                    }
                }
                
                if (i % 20 === 0) console.log(`Processed ${i}/${programs.length} programs...`);
            } catch (e) {
                console.warn(`Failed ${prog.id}: ${e.message}`);
                if (!UQ_OPTIONS.majors[prog.id]) UQ_OPTIONS.majors[prog.id] = [{ id: 'NONE', label: 'No Major' }];
            }
        }
    }

    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);

    // Save final state
    let dataJsStr = `// Automatically scraped UQ Structure Directory
// Covers all UG/PG Programs -> Majors -> Bound Minors.

const UQ_OPTIONS = ${JSON.stringify(UQ_OPTIONS, null, 4)};

let DEGREES = {};
`;
    fs.writeFileSync('data.js', dataJsStr);
    console.log("Successfully assembled all UQ offerings with deep structural filtering! Wrote data.js");
}

run();
