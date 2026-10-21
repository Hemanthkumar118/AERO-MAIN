import fs from 'fs';

const content = fs.readFileSync('server/index.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, i) => {
  if (line.includes('app.get(') || line.includes('app.post(') || line.includes('app.patch(') || line.includes('app.delete(')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
});
