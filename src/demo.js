'use strict';

// Enough bounded sample text to keep typing for 30 seconds even at 400 chars/s.
const before = '// specter test\nconst message = "hello";\n\nconsole.log(message);\n';
const after = [
  '// specter test',
  'const message = "specter is working";',
  'const items = [',
  ...Array.from({ length: 200 }, (_, index) =>
    `  { id: ${index + 1}, label: "sample item ${String(index + 1).padStart(3, '0')}: try the speed slider or skip", ready: true },`),
  '];',
  '',
  'const readyItems = items.filter(item => item.ready);',
  'for (const item of readyItems) {',
  '  console.log(item.label);',
  '}',
  '',
  'console.log(message);',
  ''
].join('\n');

module.exports = { before, after, durationMs: 30000, inspectionMs: 5000, maxCharacters: 20000 };
