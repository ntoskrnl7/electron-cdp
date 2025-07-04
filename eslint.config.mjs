import tsEsLint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
    { files: ["**/*.{ts}"] },
    ...tsEsLint.configs.recommended
];