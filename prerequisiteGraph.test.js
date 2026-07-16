const assert = require('node:assert/strict');
const test = require('node:test');

const { sortCoursesByPrerequisites } = require('./prerequisiteGraph');

test('sorts a prerequisite DAG into a valid enrolment order', () => {
    const result = sortCoursesByPrerequisites([
        { code: 'COMP3000', prereqs: ['COMP2000'] },
        { code: 'COMP1000', prereqs: [] },
        { code: 'COMP2000', prereqs: ['COMP1000'] },
        { code: 'MATH1000', prereqs: [] }
    ]);

    assert.equal(result.valid, true);
    assert.deepEqual(result.order, ['COMP1000', 'MATH1000', 'COMP2000', 'COMP3000']);
    assert.deepEqual(result.cycles, []);
    assert.deepEqual(result.missingPrerequisites, []);
});

test('reports cycle chains as invalid prerequisite chains', () => {
    const result = sortCoursesByPrerequisites([
        { code: 'COMP1000', prereqs: ['COMP3000'] },
        { code: 'COMP2000', prereqs: ['COMP1000'] },
        { code: 'COMP3000', prereqs: ['COMP2000'] }
    ]);

    assert.equal(result.valid, false);
    assert.deepEqual(result.order, []);
    assert.deepEqual(result.cycles, [['COMP1000', 'COMP3000', 'COMP2000', 'COMP1000']]);
    assert.deepEqual(result.unresolvedCodes, ['COMP1000', 'COMP2000', 'COMP3000']);
});

test('reports prerequisites that are not in the course graph', () => {
    const result = sortCoursesByPrerequisites([
        { code: 'COMP2000', prereqs: ['COMP1000'] }
    ]);

    assert.equal(result.valid, false);
    assert.deepEqual(result.order, ['COMP2000']);
    assert.deepEqual(result.missingPrerequisites, [
        { course: 'COMP2000', prereq: 'COMP1000', reason: 'not-found' }
    ]);
});

test('can require selected plans to include their prerequisites', () => {
    const result = sortCoursesByPrerequisites([
        { code: 'COMP1000', prereqs: [] },
        { code: 'COMP2000', prereqs: ['COMP1000'] }
    ], {
        selectedCodes: ['COMP2000'],
        requireSelectedPrerequisites: true
    });

    assert.equal(result.valid, false);
    assert.deepEqual(result.order, ['COMP2000']);
    assert.deepEqual(result.missingPrerequisites, [
        { course: 'COMP2000', prereq: 'COMP1000', reason: 'not-selected' }
    ]);
});

test('accepts one fully selected prerequisite alternative without flagging the others', () => {
    const result = sortCoursesByPrerequisites([
        { code: 'CSSE1001', prereqs: [] },
        { code: 'ENGG1001', prereqs: [] },
        {
            code: 'COMP3702',
            prereqs: ['CSSE1001', 'ENGG1001'],
            prereqOptions: [['CSSE1001'], ['ENGG1001']]
        }
    ], {
        selectedCodes: ['ENGG1001', 'COMP3702'],
        requireSelectedPrerequisites: true
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.missingPrerequisites, []);
    assert.deepEqual(result.order, ['ENGG1001', 'COMP3702']);
});

test('reports only the closest unsatisfied prerequisite option', () => {
    const result = sortCoursesByPrerequisites([
        { code: 'CSSE2002', prereqs: [] },
        { code: 'MATH1061', prereqs: [] },
        { code: 'MATH1081', prereqs: [] },
        {
            code: 'COMP3506',
            prereqs: ['CSSE2002', 'MATH1061', 'MATH1081'],
            prereqOptions: [
                ['CSSE2002', 'MATH1061'],
                ['CSSE2002', 'MATH1081']
            ]
        }
    ], {
        selectedCodes: ['CSSE2002', 'COMP3506'],
        requireSelectedPrerequisites: true
    });

    assert.deepEqual(result.missingPrerequisites, [
        { course: 'COMP3506', prereq: 'MATH1061', reason: 'not-selected' }
    ]);
});
