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
        MINOR_COMPULSORY: 'Minor Compulsory',
        MINOR_ELECTIVE: 'Minor Elective',
        OTHER_ELECTIVE: 'Other Elective'
    });

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
        buildSemesters,
        getAvailableStartYears,
        getStudyYears,
        isSoftwareAiTransition,
        resolvePlanId,
        resolveCourseCategories
    };
});
