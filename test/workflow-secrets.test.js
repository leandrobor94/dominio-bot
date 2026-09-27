'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const workflow of ['vigilar.yml', 'probar-gemini.yml']) {
  test(`${workflow} entrega el secreto multilinea a Gemini`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', workflow), 'utf8');
    assert.match(source, /GEMINI_API_KEYS:\s*\$\{\{\s*secrets\.GEMINI_API_KEYS\s*\}\}/);
    assert.match(source, /GEMINI_API_KEY:\s*\$\{\{\s*secrets\.GEMINI_API_KEY\s*\}\}/);
  });
}
