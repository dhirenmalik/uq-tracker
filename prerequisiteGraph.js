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
                prereqs: uniqueNormalizedCodes(course.prereqs),
                prereqOptions: normalizePrerequisiteOptions(course)
            });
            orderedCodes.push(code);
        });

        return { byCode, orderedCodes };
    }

    function normalizePrerequisiteOptions(course) {
        const options = Array.isArray(course?.prereqOptions)
            ? course.prereqOptions
                .map(option => uniqueNormalizedCodes(option))
                .filter(option => option.length > 0)
            : [];
        if (options.length > 0) return options;
        const prereqs = uniqueNormalizedCodes(course?.prereqs);
        return prereqs.length > 0 ? [prereqs] : [];
    }

    function selectPrerequisiteOption(node, byCode, selectedSet, requireSelectedPrerequisites) {
        if (!node || node.prereqOptions.length === 0) {
            return { selected: [], missing: [] };
        }

        const evaluated = node.prereqOptions.map(option => {
            const missing = option.filter(code =>
                !byCode.has(code) || (requireSelectedPrerequisites && !selectedSet.has(code))
            );
            return { option, missing };
        });
        const satisfied = evaluated
            .filter(result => result.missing.length === 0)
            .sort((left, right) => left.option.length - right.option.length)[0];
        if (satisfied) return { selected: satisfied.option, missing: [] };

        const closest = evaluated.sort((left, right) =>
            left.missing.length - right.missing.length || left.option.length - right.option.length
        )[0];
        return { selected: [], missing: closest?.missing || [] };
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
            const prerequisiteChoice = selectPrerequisiteOption(
                node,
                byCode,
                selectedSet,
                requireSelectedPrerequisites
            );
            prerequisiteChoice.missing.forEach(prereqCode => {
                const prereqExists = byCode.has(prereqCode);
                missingPrerequisites.push({
                    course: code,
                    prereq: prereqCode,
                    reason: prereqExists ? 'not-selected' : 'not-found'
                });
            });

            prerequisiteChoice.selected.forEach(prereqCode => {
                if (!selectedSet.has(prereqCode)) return;
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
