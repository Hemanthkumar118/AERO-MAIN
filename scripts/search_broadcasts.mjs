import fs from 'fs';

const content = fs.readFileSync('server/index.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, i) => {
  if (line.includes('incidents_updated')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
