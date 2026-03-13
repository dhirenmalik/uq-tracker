async function testFetch() {
    const courseCode = 'COMP3301';
    for (const year of [2025, 2024]) {
        try {
            const formBody = `search-term=${courseCode}&semester=ALL&campus=ALL&faculty=ALL&type=ALL&days=1&days=2&days=3&days=4&days=5&days=6&days=0&start-time=00%3A00&end-time=23%3A00`;
            const res = await fetch('https://lingering-bush-c27d.late-night.workers.dev/?/subjects', {
                method: 'POST',
                headers: {
                    'accept': 'application/json, text/javascript, */*; q=0.01',
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'year': year.toString()
                },
                body: formBody
            });
            const data = await res.json();
            const sems = new Set();
            Object.keys(data).forEach(key => {
                if (key.toUpperCase().startsWith(courseCode)) {
                    const semStr = data[key].semester;
                    if (semStr === 'S1') sems.add(1);
                    if (semStr === 'S2') sems.add(2);
                }
            });
            if (sems.size > 0) {
                console.log(`Found for ${courseCode} in ${year}:`, Array.from(sems).sort());
                return Array.from(sems).sort();
            }
        } catch (e) {
            console.error(e);
        }
    }
    console.log(`Not found for ${courseCode}`);
    return [1, 2];
}
testFetch();
