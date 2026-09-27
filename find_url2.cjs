const fs = require('fs');
const lines = fs.readFileSync('C:/Users/HEMANTHHHZZ/.gemini/antigravity-ide/brain/dc1fe59a-779b-4368-8685-dfbb45ba9967/.system_generated/logs/transcript_full.jsonl', 'utf8').split('\n');
for (const line of lines) {
  if (line.includes('postgresql://')) {
    try {
      const obj = JSON.parse(line);
      if (obj.content && obj.content.includes('postgresql://')) {
        const match = obj.content.match(/postgresql:\/\/[^\s\"']+/);
        if (match) console.log(match[0]);
      }
    } catch(e) {}
  }
}
