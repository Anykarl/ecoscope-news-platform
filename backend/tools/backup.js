// Simple backup script using archiver (MIT) to zip the project excluding node_modules and backups
// Usage: npm run backup [--name mylabel]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const backupsDir = path.join(projectRoot, 'backups');

if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const argNameIndex = process.argv.indexOf('--name');
const label = argNameIndex !== -1 ? (process.argv[argNameIndex+1] || '').replace(/[^a-zA-Z0-9-_]/g,'').slice(0,40) : '';
const filename = `ecoscope-${stamp}${label?'-'+label:''}.zip`;
const outPath = path.join(backupsDir, filename);

const output = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const size = archive.pointer();
  console.log(`Backup created: ${filename} (${Math.round(size/1024)} KB)`);
  // update index.json
  const indexPath = path.join(backupsDir, 'index.json');
  let list = [];
  try { if (fs.existsSync(indexPath)) list = JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch {}
  if (!Array.isArray(list)) list = [];
  list.unshift({ name: filename, path: `backups/${filename}`, size, createdAt: now.toISOString() });
  // keep last 50 entries
  if (list.length > 50) list = list.slice(0,50);
  fs.writeFileSync(indexPath, JSON.stringify(list, null, 2));
});

archive.on('warning', err => { if (err.code === 'ENOENT') { console.warn(err.message); } else { throw err; } });
archive.on('error', err => { throw err; });

archive.pipe(output);

// add project root recursively with filters
archive.glob('**/*', {
  cwd: projectRoot,
  dot: true,
  ignore: [
    'node_modules/**',
    'backups/**',
    '**/.git/**',
    '**/.cache/**',
    '**/dist/**'
  ]
});

archive.finalize();
