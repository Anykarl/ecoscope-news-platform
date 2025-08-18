// Manual restore helper: extracts a selected zip under a temporary directory then prompts user to replace.
// For safety, this script only extracts to ./.restore/<backupName> and prints manual steps.
// Usage: npm run restore -- --name ecoscope-YYYYMMDD-HHMM.zip
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import unzipper from 'unzipper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const backupsDir = path.join(projectRoot, 'backups');

const argNameIndex = process.argv.indexOf('--name');
let name = argNameIndex !== -1 ? process.argv[argNameIndex+1] : '';
if (!name || name === 'selected') {
  // try read selected.json
  const sel = path.join(backupsDir, 'selected.json');
  if (fs.existsSync(sel)) {
    try { const j = JSON.parse(fs.readFileSync(sel,'utf-8')); if (j?.name) name = j.name; } catch {}
  }
}

if (!name) {
  console.error('Missing --name <backupFile>. You can also save a selection via API then pass --name selected');
  process.exit(1);
}

const zipPath = path.join(backupsDir, name);
if (!fs.existsSync(zipPath)) {
  console.error('Backup not found:', zipPath);
  process.exit(1);
}

const restoreRoot = path.join(projectRoot, '.restore');
if (!fs.existsSync(restoreRoot)) fs.mkdirSync(restoreRoot, { recursive: true });
const dest = path.join(restoreRoot, name.replace(/\.zip$/,''));
if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

console.log('Extracting to', dest);
fs.createReadStream(zipPath)
  .pipe(unzipper.Extract({ path: dest }))
  .on('close', () => {
    console.log('Extraction done. Review the restored content at:', dest);
    console.log('Manual restore steps (recommended):');
    console.log('- Close running dev servers.');
    console.log('- Make a copy of current project as safety.');
    console.log(`- Replace project files with contents from: ${dest}`);
    console.log('- Re-run npm install where needed.');
  })
  .on('error', (e) => {
    console.error('Extraction error:', e);
    process.exit(1);
  });
