const DEGREES = {
    se_ai: {
        id: 'se_ai',
        title: 'Software Engineering (AI Minor) — BE(Hons)',
        years: '2024 to 2027',
        semesters: [
            { id: 'sem-24-1', name: '2024 Sem 1', semNum: 1 },
            { id: 'sem-24-2', name: '2024 Sem 2', semNum: 2 },
            { id: 'sem-25-1', name: '2025 Sem 1', semNum: 1 },
            { id: 'sem-25-2', name: '2025 Sem 2', semNum: 2 },
            { id: 'sem-26-1', name: '2026 Sem 1', semNum: 1 },
            { id: 'sem-26-2', name: '2026 Sem 2', semNum: 2 },
            { id: 'sem-27-1', name: '2027 Sem 1', semNum: 1 },
            { id: 'sem-27-2', name: '2027 Sem 2', semNum: 2 },
        ],
        requirements: [
            { id: 'total', name: 'Total Units', target: 64, filter: () => true, color: 'var(--accent-color)' },
            { id: 'core', name: 'BE Core', target: 8, filter: c => c.cat === 'Core', color: 'var(--cat-core)' },
            { id: 'secore', name: 'SE Compulsory', target: 34, filter: c => c.cat === 'SE Core', color: 'var(--cat-se)' },
            { id: 'aiminor', name: 'AI Minor', target: 8, filter: c => c.cat === 'AI Minor' || c.code === 'COMP2701', color: 'var(--cat-ai)' },
            { id: 'seext', name: 'SE Extension', target: 2, filter: c => c.cat === 'SE Ext', color: 'var(--cat-ext)' },
            { id: 'seadv', name: 'SE Adv. Electives', target: 6, filter: c => c.cat === 'SE Adv', color: 'var(--cat-adv)' },
        ],
        courses: [
            // BE(Hons) Core (8 units)
            { code: 'ENGG1100', name: 'Professional Engineering', units: 2, cat: 'Core', semesters: [1, 2] },
            { code: 'ENGG1001', name: 'Programming for Engineers', units: 2, cat: 'Core', semesters: [1, 2], exclusiveWith: ['CSSE1001'] },
            { code: 'CSSE1001', name: 'Introduction to Software Engineering', units: 2, cat: 'Core', semesters: [1, 2], exclusiveWith: ['ENGG1001'] },
            { code: 'MATH1051', name: 'Calculus & Linear Algebra I', units: 2, cat: 'Core', semesters: [1, 2], exclusiveWith: ['MATH1071'] },
            { code: 'MATH1071', name: 'Advanced Calculus & Linear Algebra I', units: 2, cat: 'Core', semesters: [1], exclusiveWith: ['MATH1051'] },
            { code: 'MATH1052', name: 'Multivariate Calculus & Ordinary Differential Equations', units: 2, cat: 'Core', semesters: [1, 2], exclusiveWith: ['MATH1072'] },
            { code: 'MATH1072', name: 'Advanced Multivariate Calculus & ODEs', units: 2, cat: 'Core', semesters: [2], exclusiveWith: ['MATH1052'] },

            // Software Engineering Compulsory (34 units total required, listed ones)
            { code: 'COMP2701', name: 'Generative Artificial Intelligence', units: 2, cat: 'SE Core', semesters: [1] },
            { code: 'COMP3506', name: 'Algorithms & Data Structures', units: 2, cat: 'SE Core', semesters: [2] },
            { code: 'CSSE2002', name: 'Programming in the Large', units: 2, cat: 'SE Core', semesters: [1, 2] },
            { code: 'CSSE2010', name: 'Introduction to Computer Systems', units: 2, cat: 'SE Core', semesters: [1, 2] },
            { code: 'CSSE2310', name: 'Computer Systems Principles and Programming', units: 2, cat: 'SE Core', semesters: [1, 2] },
            { code: 'CSSE3030', name: 'Software Testing and Automation', units: 2, cat: 'SE Core', semesters: [2] },
            { code: 'CSSE3200', name: 'Software Engineering Studio: Design, Implement & Test', units: 2, cat: 'SE Core', semesters: [2] },
            { code: 'CSSE4801', name: 'Software Engineering Studio: Build', units: 2, cat: 'SE Core', semesters: [] },
            { code: 'CSSE6400', name: 'Software Architecture', units: 2, cat: 'SE Core', semesters: [1] },
            { code: 'DECO2500', name: 'Human-Computer Interaction', units: 2, cat: 'SE Core', semesters: [1, 2] },
            { code: 'ENGG1300', name: 'Introduction to Electrical Systems', units: 2, cat: 'SE Core', semesters: [1, 2] },
            { code: 'INFS1200', name: 'Introduction to Information Systems', units: 2, cat: 'SE Core', semesters: [1, 2] },
            { code: 'MATH1061', name: 'Discrete Mathematics', units: 2, cat: 'SE Core', semesters: [1, 2] },
            { code: 'MATH1081', name: 'Advanced Discrete Mathematics', units: 2, cat: 'SE Core', semesters: [1] },
            { code: 'STAT2203', name: 'Probability Models & Data Analysis', units: 2, cat: 'SE Core', semesters: [2] },
            { code: 'REIT4841', name: 'Research & Development Methods and Practice', units: 4, cat: 'SE Core', semesters: [1, 2], isYearLong: true },
            { code: 'REIT4842', name: 'Research & Development Methods and Practice', units: 4, cat: 'SE Core', semesters: [1, 2], isYearLong: true },
            { code: 'ENGG4901', name: 'Professional Practice and the Business Environment A', units: 2, cat: 'SE Core', semesters: [1] },
            { code: 'ENGG4902', name: 'Professional Practice and the Business Environment B', units: 2, cat: 'SE Core', semesters: [2] },

            // AI Minor (8 units total, but specific rules apply)
            { code: 'COMP3702', name: 'Artificial Intelligence', units: 2, cat: 'AI Minor', semesters: [2] },
            { code: 'COMP4702', name: 'Machine Learning', units: 2, cat: 'AI Minor', semesters: [1] },
            { code: 'COMP3710', name: 'Pattern Recognition and Analysis', units: 2, cat: 'AI Minor', semesters: [2] },
            { code: 'COMP4703', name: 'Natural Language Processing', units: 2, cat: 'AI Minor', semesters: [2] },
            { code: 'DECO2801', name: 'Human-Centred AI', units: 2, cat: 'AI Minor', semesters: [2] },
            { code: 'ELEC4630', name: 'Computer Vision and Deep Learning', units: 2, cat: 'AI Minor', semesters: [1] },
            { code: 'STAT3006', name: 'Statistical Learning', units: 2, cat: 'AI Minor', semesters: [1, 2] },
            { code: 'STAT3007', name: 'Deep Learning', units: 2, cat: 'AI Minor', semesters: [1, 2] },

            // SE Extension Courses (2 units)
            { code: 'DECO3800', name: 'Design Computing Studio 3 - Proposal', units: 2, cat: 'SE Ext', semesters: [1, 2] },

            // SE Advanced Electives (6 units)
            { code: 'COMP3301', name: 'Operating Systems Architecture', units: 2, cat: 'SE Adv', semesters: [2] },
            { code: 'COMP3320', name: 'Vulnerability Assessment and Penetration Testing', units: 2, cat: 'SE Adv', semesters: [1] },
            { code: 'COMP3400', name: 'Functional & Logic Programming', units: 2, cat: 'SE Adv', semesters: [1] },
            { code: 'COMP3820', name: 'Digital Health Software Project', units: 2, cat: 'SE Adv', semesters: [2] },
            { code: 'COMP4403', name: 'Compilers and Interpreters', units: 2, cat: 'SE Adv', semesters: [1] },
            { code: 'COMP4500', name: 'Advanced Algorithms & Data Structures', units: 2, cat: 'SE Adv', semesters: [2] },
            { code: 'COMS3200', name: 'Computer Networks I', units: 2, cat: 'SE Adv', semesters: [1] },
            { code: 'COMS4507', name: 'Advanced Topics in Security', units: 2, cat: 'SE Adv', semesters: [1] },
            { code: 'COSC3000', name: 'Visualization, Computer Graphics & Data Analysis', units: 2, cat: 'SE Adv', semesters: [1] },
            { code: 'COSC3500', name: 'High-Performance Computing', units: 2, cat: 'SE Adv', semesters: [2] },

            // Electives Placeholder
            { code: 'ELEC_GEN_1', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_2', name: 'General/BE Elective', units: 2, cat: 'Elective' },
            { code: 'ELEC_GEN_3', name: 'General/BE Elective', units: 2, cat: 'Elective' },
        ]
    },
    cs: {
        id: 'cs',
        title: 'Computer Science (Placeholder)',
        years: '2024 to 2026',
        semesters: [
            { id: 'sem-24-1', name: '2024 Sem 1', semNum: 1 },
            { id: 'sem-24-2', name: '2024 Sem 2', semNum: 2 },
            { id: 'sem-25-1', name: '2025 Sem 1', semNum: 1 },
            { id: 'sem-25-2', name: '2025 Sem 2', semNum: 2 },
            { id: 'sem-26-1', name: '2026 Sem 1', semNum: 1 },
            { id: 'sem-26-2', name: '2026 Sem 2', semNum: 2 },
        ],
        requirements: [
            { id: 'total', name: 'Total Units', target: 48, filter: () => true, color: 'var(--accent-color)' },
            { id: 'core', name: 'CS Core', target: 16, filter: c => c.cat === 'CS Core', color: 'var(--cat-core)' },
            { id: 'electives', name: 'Electives', target: 32, filter: c => c.cat === 'Elective', color: 'var(--cat-elec)' },
        ],
        courses: [
            { code: 'CSSE1001', name: 'Introduction to Software Engineering', units: 2, cat: 'CS Core', semesters: [1, 2] },
            { code: 'MATH1061', name: 'Discrete Mathematics', units: 2, cat: 'CS Core', semesters: [1, 2] },
            { code: 'CSSE2002', name: 'Programming in the Large', units: 2, cat: 'CS Core', semesters: [1, 2] },
            { code: 'CSSE2010', name: 'Introduction to Computer Systems', units: 2, cat: 'CS Core', semesters: [1, 2] },
            { code: 'COMP3506', name: 'Algorithms & Data Structures', units: 2, cat: 'CS Core', semesters: [2] },
            { code: 'CS_ELEC_1', name: 'CS Elective 1', units: 2, cat: 'Elective' },
            { code: 'CS_ELEC_2', name: 'CS Elective 2', units: 2, cat: 'Elective' },
        ]
    }
};

const CAT_COLORS = {
    'Core': 'var(--cat-core)',
    'SE Core': 'var(--cat-se)',
    'AI Minor': 'var(--cat-ai)',
    'SE Ext': 'var(--cat-ext)',
    'SE Adv': 'var(--cat-adv)',
    'CS Core': 'var(--cat-core)',
    'Elective': 'var(--cat-elec)',
};
