const assert = require('node:assert/strict');
const test = require('node:test');

const {
    CATEGORIES,
    getAvailableStartYears,
    resolvePlanId,
    resolveCourseCategories
} = require('./degreeRules');

const transition = {
    rulesYear: 2026,
    majorId: 'SOFTWE2455',
    minorId: 'ARINTA2455'
};

test('allows a rules year to be back-shifted by up to two years', () => {
    assert.deepEqual(getAvailableStartYears(2026), [2026, 2025, 2024]);
});

test('resolves combined-degree plan aliases from the program requirements', () => {
    assert.equal(resolvePlanId('PURMAC2567', [
        'APPMAC2460',
        'PURMAC2460',
        'STATSA2460'
    ]), 'PURMAC2460');
});

test('assigns COMP3400 to Software compulsory for the 2026 AI transition', () => {
    assert.deepEqual(resolveCourseCategories('COMP3400', [
        CATEGORIES.SOFTWARE_ADVANCED
    ], transition), [CATEGORIES.SOFTWARE_COMPULSORY]);
});

test('assigns COMP2701 only to AI minor compulsory for the chosen transition path', () => {
    assert.deepEqual(resolveCourseCategories('COMP2701', [
        CATEGORIES.SOFTWARE_COMPULSORY,
        CATEGORIES.MINOR_COMPULSORY
    ], transition), [CATEGORIES.MINOR_COMPULSORY]);
});

test('compulsory categories win over elective categories', () => {
    assert.deepEqual(resolveCourseCategories('COMP3702', [
        CATEGORIES.SOFTWARE_ADVANCED,
        CATEGORIES.MINOR_COMPULSORY
    ], transition), [CATEGORIES.MINOR_COMPULSORY]);
});

test('courses elective in both lists remain user-assignable to one list', () => {
    assert.deepEqual(resolveCourseCategories('COMP3710', [
        CATEGORIES.SOFTWARE_ADVANCED,
        CATEGORIES.MINOR_ELECTIVE
    ], transition), [
        CATEGORIES.SOFTWARE_ADVANCED,
        CATEGORIES.MINOR_ELECTIVE
    ]);
});
