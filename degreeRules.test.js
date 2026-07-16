const assert = require('node:assert/strict');
const test = require('node:test');

const {
    CATEGORIES,
    buildSemesters,
    getAvailableStartYears,
    getLegacyComputerScienceMajors,
    getStudyYears,
    prerequisiteExpressionToOptions,
    resolvePlanId,
    resolveProgramId,
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

test('builds summer semesters only for the years selected by the user', () => {
    assert.deepEqual(getStudyYears(2024, 4), [2024, 2025, 2026, 2027]);
    assert.deepEqual(buildSemesters(2024, 2, [2025]).map(semester => semester.id), [
        'sem-24-1',
        'sem-24-2',
        'sem-25-1',
        'sem-25-2',
        'sem-25-summer'
    ]);
});

test('resolves combined-degree plan aliases from the program requirements', () => {
    assert.equal(resolvePlanId('PURMAC2567', [
        'APPMAC2460',
        'PURMAC2460',
        'STATSA2460'
    ]), 'PURMAC2460');
});

test('uses legacy Computer Science program and major rules before 2026', () => {
    assert.equal(resolveProgramId('2569', 2024), '2489');
    assert.equal(resolveProgramId('2559', 2025), '2451');
    assert.equal(resolveProgramId('2559', 2026), '2559');
    assert.ok(getLegacyComputerScienceMajors().some(major => major.id === 'SCCOMC2451'));
});

test('preserves prerequisite alternatives instead of treating every code as mandatory', () => {
    assert.deepEqual(
        prerequisiteExpressionToOptions('CSSE2002 and (MATH1061 or MATH1081 or MATH1051)'),
        [
            ['CSSE2002', 'MATH1061'],
            ['CSSE2002', 'MATH1081'],
            ['CSSE2002', 'MATH1051']
        ]
    );
    assert.deepEqual(
        prerequisiteExpressionToOptions('(CSSE1001 or CSSE7030) or ENGG1001'),
        [['CSSE1001'], ['CSSE7030'], ['ENGG1001']]
    );
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
