import { wrapMarkdownText } from './src/utils/markdown';

const testCases = [
  { text: 'This is a very long line with **bold text** that should be wrapped correctly', maxWidth: 30 },
  { text: 'Short **bold** text', maxWidth: 50 },
  { text: 'This has *italic* and `code` and **bold** all mixed together in a long line', maxWidth: 25 },
  { text: 'Normal text without any formatting but it is very long and needs wrapping', maxWidth: 20 }
];

console.log('Testing Markdown Wrapping:\n');

for (const test of testCases) {
  console.log(`Input: "${test.text}"`);
  console.log(`Max Width: ${test.maxWidth}`);
  const lines = wrapMarkdownText(test.text, test.maxWidth);
  console.log('Wrapped Lines:');
  lines.forEach((line, i) => {
    console.log(`  ${i + 1}. "${line.text}" (${line.text.length} chars)`);
    console.log(`     Segments:`, line.segments.map(s => `${s.type}:"${s.content}"`).join(', '));
  });
  console.log('---\n');
}
