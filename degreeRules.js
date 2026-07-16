(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.DegreeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CATEGORIES = Object.freeze({
        PROGRAM_CORE: 'Program Core',
        PROGRAM_ELECTIVE: 'Program Elective',
        SOFTWARE_COMPULSORY: 'Major Compulsory',
        SOFTWARE_EXTENSION: 'Major Extension',
        SOFTWARE_ADVANCED: 'Major Advanced Elective',
        MAJOR_ELECTIVE: 'Major Elective',
        SECOND_MAJOR_COMPULSORY: 'Second Major Compulsory',
        SECOND_MAJOR_ELECTIVE: 'Second Major Elective',
        MINOR_COMPULSORY: 'Minor Compulsory',
        MINOR_ELECTIVE: 'Minor Elective',
        OTHER_ELECTIVE: 'Other Elective'
    });

    const LEGACY_PROGRAM_IDS = Object.freeze({
        '2559': '2451',
        '2560': '2481',
        '2561': '2482',
        '2562': '2483',
        '2563': '2463',
        '2564': '2464',
        '2565': '2524',
        '2566': '2484',
        '2567': '2497',
        '2568': '2480',
        '2569': '2489'
    });

    const LEGACY_COMPUTER_SCIENCE_MAJORS = Object.freeze([
        { id: 'CYBERC2451', label: 'Cyber Security Major' },
        { id: 'DATASC2451', label: 'Data Science Major' },
        { id: 'MACHDC2451', label: 'Machine Learning Major' },
        { id: 'PROLAC2451', label: 'Programming Languages Major' },
        { id: 'SCCOMC2451', label: 'Scientific Computing Major' }
    ]);

    const COURSE_EQUIVALENCE_GROUPS = Object.freeze([
        Object.freeze(['CSSE1001', 'ENGG1001']),
        Object.freeze(['MATH1051', 'MATH1071']),
        Object.freeze(['MATH1052', 'MATH1072']),
        Object.freeze(['MATH1061', 'MATH1081'])
    ]);

    function getAvailableStartYears(rulesYear) {
        const year = parseInt(rulesYear, 10);
        if (!Number.isFinite(year)) return [];
        return [year, year - 1, year - 2];
    }

    function getStudyYears(startYear, yearsOfStudy = 4) {
        const firstYear = parseInt(startYear, 10);
        if (!Number.isFinite(firstYear)) return [];
        return Array.from({ length: yearsOfStudy }, (_, index) => firstYear + index);
    }

    function buildSemesters(startYear, yearsOfStudy, summerYears = []) {
        const selectedSummerYears = new Set((summerYears || []).map(Number));
        return getStudyYears(startYear, yearsOfStudy).flatMap(year => {
            const shortYear = year.toString().slice(-2);
            const semesters = [
                { id: `sem-${shortYear}-1`, name: `${year} Sem 1`, year, semNum: 1, term: 'semester-1' },
                { id: `sem-${shortYear}-2`, name: `${year} Sem 2`, year, semNum: 2, term: 'semester-2' }
            ];
            if (selectedSummerYears.has(year)) {
                semesters.push({
                    id: `sem-${shortYear}-summer`,
                    name: `${year} Summer Semester`,
                    year,
                    semNum: 'summer',
                    term: 'summer'
                });
            }
            return semesters;
        });
    }

    function isSoftwareAiTransition(context) {
        return parseInt(context.rulesYear, 10) === 2026
            && context.majorId === 'SOFTWE2455'
            && context.minorId === 'ARINTA2455';
    }

    function unique(values) {
        return [...new Set((values || []).filter(Boolean))];
    }

    function resolvePlanId(selectedPlanId, availablePlanIds) {
        if (!selectedPlanId || selectedPlanId === 'NONE') return selectedPlanId;
        const available = unique(availablePlanIds);
        if (available.includes(selectedPlanId)) return selectedPlanId;

        const selectedPrefix = selectedPlanId.match(/^[A-Z]+/)?.[0];
        if (!selectedPrefix) return selectedPlanId;
        const alias = available.find(planId => planId.match(/^[A-Z]+/)?.[0] === selectedPrefix);
        return alias || selectedPlanId;
    }

    function resolveProgramId(programId, rulesYear) {
        return parseInt(rulesYear, 10) < 2026
            ? (LEGACY_PROGRAM_IDS[programId] || programId)
            : programId;
    }

    function getLegacyComputerScienceMajors() {
        return LEGACY_COMPUTER_SCIENCE_MAJORS.map(major => ({ ...major }));
    }

    function getEquivalentCourseCodes(code) {
        const normalized = String(code || '').trim().toUpperCase();
        if (!normalized) return [];
        const group = COURSE_EQUIVALENCE_GROUPS.find(codes => codes.includes(normalized));
        return group ? group.filter(candidate => candidate !== normalized) : [];
    }

    function findEquivalentCourseCode(code, availableCodes) {
        const normalized = String(code || '').trim().toUpperCase();
        const available = new Set(
            Array.from(availableCodes || [], candidate => String(candidate || '').trim().toUpperCase())
        );
        return [normalized, ...getEquivalentCourseCodes(normalized)]
            .find(candidate => available.has(candidate)) || null;
    }

    function prerequisiteExpressionToOptions(text) {
        const source = String(text || '').toUpperCase();
        const tokens = source.match(/[A-Z]{4}\d{4}|\(|\)|\bAND\b|\bOR\b/g) || [];
        if (tokens.length === 0) return [];
        let position = 0;

        function parsePrimary() {
            const token = tokens[position++];
            if (!token) return null;
            if (/^[A-Z]{4}\d{4}$/.test(token)) return { type: 'code', code: token };
            if (token === '(') {
                const expression = parseOr();
                if (tokens[position] === ')') position += 1;
                return expression;
            }
            return null;
        }

        function parseAnd() {
            let left = parsePrimary();
            while (tokens[position] === 'AND') {
                position += 1;
                const right = parsePrimary();
                if (left && right) left = { type: 'and', left, right };
            }
            return left;
        }

        function parseOr() {
            let left = parseAnd();
            while (tokens[position] === 'OR') {
                position += 1;
                const right = parseAnd();
                if (left && right) left = { type: 'or', left, right };
            }
            return left;
        }

        function toOptions(node) {
            if (!node) return [];
            if (node.type === 'code') return [[node.code]];
            if (node.type === 'or') return [...toOptions(node.left), ...toOptions(node.right)];
            if (node.type === 'and') {
                const leftOptions = toOptions(node.left);
                const rightOptions = toOptions(node.right);
                return leftOptions.flatMap(left =>
                    rightOptions.map(right => unique([...left, ...right]))
                );
            }
            return [];
        }

        const parsed = parseOr();
        let options = toOptions(parsed);
        const allCodes = unique(source.match(/[A-Z]{4}\d{4}/g) || []);
        if (position < tokens.length || options.length === 0) options = [allCodes];
        return options
            .map(option => unique(option))
            .filter(option => option.length > 0)
            .filter((option, index, all) =>
                all.findIndex(other => other.join('|') === option.join('|')) === index
            );
    }

    function resolveCourseCategories(code, sourceCategories, context = {}) {
        let categories = unique(sourceCategories);

        if (isSoftwareAiTransition(context)) {
            if (code === 'COMP2701') {
                categories = categories.filter(cat => cat !== CATEGORIES.SOFTWARE_COMPULSORY);
                categories.push(CATEGORIES.MINOR_COMPULSORY);
            }
            if (code === 'COMP3400') {
                categories = categories.filter(cat => cat !== CATEGORIES.SOFTWARE_ADVANCED);
                categories.push(CATEGORIES.SOFTWARE_COMPULSORY);
            }
        }

        categories = unique(categories);
        const compulsory = categories.filter(cat =>
            cat === CATEGORIES.PROGRAM_CORE || cat.endsWith('Compulsory')
        );

        // A compulsory use always wins over an elective use. Transition-specific
        // substitutions above remove the displaced compulsory category first.
        if (compulsory.length > 0) return [compulsory[0]];

        return categories;
    }

    return {
        CATEGORIES,
        COURSE_EQUIVALENCE_GROUPS,
        buildSemesters,
        findEquivalentCourseCode,
        getAvailableStartYears,
        getEquivalentCourseCodes,
        getLegacyComputerScienceMajors,
        getStudyYears,
        isSoftwareAiTransition,
        prerequisiteExpressionToOptions,
        resolvePlanId,
        resolveProgramId,
        resolveCourseCategories
    };
});
