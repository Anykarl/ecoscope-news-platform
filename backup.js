// Backup script with numbering and history (CommonJS)
// Produces backups/backups files named: sauvegarde_NN_YYYY-MM-DD_description.zip
// Appends a line to backups/history.txt: "NN - YYYY-MM-DD : description"

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function todayStr(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function slugify(s) {
  return String(s || 'backup')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

function detectNextNumber(backupsDir, historyPath) {
  let maxN = 0;
  // Parse filenames
  if (fs.existsSync(backupsDir)) {
    for (const f of fs.readdirSync(backupsDir)) {
      const m = /^sauvegarde_(\d{2})_\d{4}-\d{2}-\d{2}_.+\.zip$/i.exec(f);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
  }
  // Parse history
  if (fs.existsSync(historyPath)) {
    const lines = String(fs.readFileSync(historyPath, 'utf-8')).split(/\r?\n/);
    for (const line of lines) {
      const m = /^(\d{2})\s*-\s*\d{4}-\d{2}-\d{2}\s*:/.exec(line.trim());
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
  }
  return maxN + 1;
}

(function main() {
  const root = process.cwd();
  const backupsDir = path.join(root, 'backups');
  ensureDir(backupsDir);
  const historyPath = path.join(backupsDir, 'history.txt');

  // Description from CLI args after '--', e.g. `npm run backup -- "ma description"`
  const args = process.argv.slice(2);
  const description = args.length ? args.join(' ') : 'sauvegarde_projet';

  const N = detectNextNumber(backupsDir, historyPath);
  const NN = String(N).padStart(2, '0');
  const dateStr = todayStr();
  const descSlug = slugify(description);
  const filename = `sauvegarde_${NN}_${dateStr}_${descSlug}.zip`;
  const outPath = path.join(backupsDir, filename);

  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`Archive créée: ${archive.pointer()} octets -> ${outPath}`);
    const line = `${NN} - ${dateStr} : ${description}`;
    fs.appendFileSync(historyPath, (fs.existsSync(historyPath) && fs.readFileSync(historyPath, 'utf-8').trim().length ? '\n' : '') + line);
    console.log(`Historique mis à jour: ${historyPath}`);
  });

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.warn('Avertissement archive:', err.message);
    } else {
      throw err;
    }
  });

  archive.on('error', (err) => { throw err; });

  archive.pipe(output);

  // Glob everything but exclude temp/heavy/sensitive paths
  archive.glob('**/*', {
    dot: false,
    ignore: [
      // dependencies and builds
      'node_modules/**',
      '**/node_modules/**',
      'dist/**',
      '**/dist/**',
      'build/**',
      '**/build/**',
      '.vite/**',
      '**/.vite/**',
      '.next/**',
      '**/.next/**',
      '.cache/**',
      '**/.cache/**',
      'coverage/**',
      '**/coverage/**',

      // logs & pids
      'logs/**',
      '**/logs/**',
      '*.log',
      '**/*.log',
      'pids/**',

      // vcs
      '.git/**',

      // env files
      '.env',
      '.env.*',
      '**/.env',
      '**/.env.*',

      // editor/OS
      '.DS_Store',
      '**/.DS_Store',
      'Thumbs.db',
      '**/Thumbs.db',

      // backups output (avoid recursive include of currently writing zip)
      'backups/**',
      'backend/backups/**',
    ]
  });

  archive.finalize();
})();
