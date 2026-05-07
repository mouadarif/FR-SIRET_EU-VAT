const browserGlobals = {
    AbortController: 'readonly',
    Blob: 'readonly',
    File: 'readonly',
    FormData: 'readonly',
    Headers: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    document: 'readonly',
    fetch: 'readonly',
    global: 'readonly',
    globalThis: 'readonly',
    localStorage: 'readonly',
    navigator: 'readonly',
    process: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    window: 'readonly'
};

const testGlobals = {
    afterAll: 'readonly',
    afterEach: 'readonly',
    beforeAll: 'readonly',
    beforeEach: 'readonly',
    describe: 'readonly',
    expect: 'readonly',
    it: 'readonly',
    vi: 'readonly'
};

export default [
    {
        ignores: [
            '.gitnexus/**',
            'dist/**',
            'node_modules/**',
            'temp_*.js'
        ]
    },
    {
        files: ['src/**/*.{js,jsx}', '*.config.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true
                }
            },
            globals: {
                ...browserGlobals,
                ...testGlobals
            }
        },
        rules: {
            'no-constant-binary-expression': 'error',
            'no-redeclare': 'error',
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }]
        }
    }
];
