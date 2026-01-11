import { parseMarkdownLine } from './src/utils/markdown';

const testCases = [
  'This is **bold** text',
  'This is *italic* text',
  'This is `code` text',
  'Mix **bold** and *italic* and `code`',
  'Normal text without formatting'
];

console.log('Testing Markdown Parser:\n');

for (const test of testCases) {
  console.log(`Input: "${test}"`);
  const segments = parseMarkdownLine(test);
  console.log('Segments:', JSON.stringify(segments, null, 2));
  console.log('---\n');
}
