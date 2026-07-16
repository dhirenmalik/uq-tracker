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
        getAvailableStartYears,
        isSoftwareAiTransition,
        resolvePlanId,
        resolveCourseCategories
    };
});
