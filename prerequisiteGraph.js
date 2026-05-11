const PrerequisiteGraph = (function (factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    return api;
})(function () {
    function normalizeCode(code) {
        return typeof code === 'string' ? code.trim().toUpperCase() : '';
    }

    function uniqueNormalizedCodes(codes) {
        const seen = new Set();
        const result = [];
        (codes || []).forEach(code => {
            const normalized = normalizeCode(code);
            if (normalized && !seen.has(normalized)) {
                seen.add(normalized);
                result.push(normalized);
            }
        });
        return result;
    }

    function buildCourseIndex(courses) {
        const byCode = new Map();
        const orderedCodes = [];

        (courses || []).forEach((course, index) => {
            if (!course) return;
            const code = normalizeCode(course.code);
            if (!code || byCode.has(code)) return;

            byCode.set(code, {
                code,
                course,
                index,
                prereqs: uniqueNormalizedCodes(course.prereqs)
            });
            orderedCodes.push(code);
        });

        return { byCode, orderedCodes };
    }

    function canonicalCycleKey(cycle) {
        const body = cycle.slice(0, -1);
        if (body.length === 0) return '';

        let best = body;
        for (let i = 1; i < body.length; i++) {
            const rotated = body.slice(i).concat(body.slice(0, i));
            if (rotated.join('|') < best.join('|')) best = rotated;
        }
        return best.join('|');
    }

    function findPrerequisiteCycles(selectedCodes, prereqMap) {
        const visitState = new Map();
        const stack = [];
        const cycles = [];
        const seenCycles = new Set();

        function visit(code) {
            visitState.set(code, 'visiting');
            stack.push(code);

            const prereqs = prereqMap.get(code) || [];
            prereqs.forEach(prereqCode => {
                const prereqState = visitState.get(prereqCode);
                if (!prereqState) {
                    visit(prereqCode);
                    return;
                }

                if (prereqState === 'visiting') {
                    const startIndex = stack.indexOf(prereqCode);
                    if (startIndex === -1) return;
                    const cycle = stack.slice(startIndex).concat(prereqCode);
                    const key = canonicalCycleKey(cycle);
                    if (!seenCycles.has(key)) {
                        seenCycles.add(key);
                        cycles.push(cycle);
                    }
                }
            });

            stack.pop();
            visitState.set(code, 'visited');
        }

        selectedCodes.forEach(code => {
            if (!visitState.has(code)) visit(code);
        });

        return cycles;
    }

    function sortCoursesByPrerequisites(courses, options) {
        const config = options || {};
        const { byCode, orderedCodes } = buildCourseIndex(courses);
        const selectedCodes = config.selectedCodes
            ? uniqueNormalizedCodes(config.selectedCodes).filter(code => byCode.has(code))
            : orderedCodes.slice();
        const selectedSet = new Set(selectedCodes);
        const requireSelectedPrerequisites = config.requireSelectedPrerequisites === true;

        const dependents = new Map();
        const indegree = new Map();
        const prereqMap = new Map();
        const missingPrerequisites = [];

        selectedCodes.forEach(code => {
            dependents.set(code, []);
            indegree.set(code, 0);
            prereqMap.set(code, []);
        });

        selectedCodes.forEach(code => {
            const node = byCode.get(code);
            node.prereqs.forEach(prereqCode => {
                const prereqExists = byCode.has(prereqCode);
                const prereqSelected = selectedSet.has(prereqCode);

                if (!prereqExists || (requireSelectedPrerequisites && !prereqSelected)) {
                    missingPrerequisites.push({
                        course: code,
                        prereq: prereqCode,
                        reason: prereqExists ? 'not-selected' : 'not-found'
                    });
                    return;
                }

                if (!prereqSelected) return;

                dependents.get(prereqCode).push(code);
                indegree.set(code, indegree.get(code) + 1);
                prereqMap.get(code).push(prereqCode);
            });
        });

        dependents.forEach(dependentCodes => {
            dependentCodes.sort((left, right) => {
                return byCode.get(left).index - byCode.get(right).index;
            });
        });

        const queue = selectedCodes
            .filter(code => indegree.get(code) === 0)
            .sort((left, right) => byCode.get(left).index - byCode.get(right).index);
        const order = [];

        while (queue.length > 0) {
            const code = queue.shift();
            order.push(code);

            dependents.get(code).forEach(dependentCode => {
                const nextIndegree = indegree.get(dependentCode) - 1;
                indegree.set(dependentCode, nextIndegree);
                if (nextIndegree === 0) {
                    queue.push(dependentCode);
                }
            });
        }

        const unresolvedCodes = selectedCodes.filter(code => !order.includes(code));
        const cycles = unresolvedCodes.length > 0
            ? findPrerequisiteCycles(selectedCodes, prereqMap)
            : [];

        return {
            valid: missingPrerequisites.length === 0 && cycles.length === 0,
            order,
            orderedCourses: order.map(code => byCode.get(code).course),
            missingPrerequisites,
            cycles,
            unresolvedCodes
        };
    }

    return {
        sortCoursesByPrerequisites
    };
});
