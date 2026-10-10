'use strict';

// Preserve executable examples, identifiers, link targets, and conventional filenames.
function lowercaseProse(text) {
  const protectedText = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\]\([^\n)]*\)|https?:\/\/[^\s)]+|\bcodexLiveFollow(?:\.[A-Za-z]\w*)?\b|\b(?:AGENTS\.md|README\.md|CONTRIBUTING\.md|SECURITY\.md|CHANGELOG\.md|LICENSE\.txt)\b/g;
  let result = '';
  let offset = 0;
  for (const match of text.matchAll(protectedText)) {
    result += text.slice(offset, match.index).toLowerCase() + match[0];
    offset = match.index + match[0].length;
  }
  return result + text.slice(offset).toLowerCase();
}

module.exports = { lowercaseProse };
