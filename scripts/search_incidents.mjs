import fs from 'fs';

const content = fs.readFileSync('server/index.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, i) => {
  if (line.includes('__AERO_INCIDENTS__')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
