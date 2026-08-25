// Admin panel routes — manifest editing, uploads, project creation.
// Mounted under /admin/api/* by server.js, behind requireBasicAuth().

const fs = require('fs');
const path = require('path');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* optional — falls back to storing uploads as-is */ }

const ROOT = path.join(__dirname, '..');
const IMAGES_ROOT = path.join(ROOT, 'images');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const FLAT_SECTIONS = ['commissioned', 'portraits', 'personal'];
const KEY_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_BACKUPS = 5;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function writeManifest(manifest) {
  backupManifest();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

function backupManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = MANIFEST_PATH + '.bak-' + stamp;
  fs.copyFileSync(MANIFEST_PATH, backupPath);
  const dir = path.dirname(MANIFEST_PATH);
  const backups = fs.readdirSync(dir).filter(f => f.startsWith('manifest.json.bak-')).sort();
  while (backups.length > MAX_BACKUPS) fs.unlinkSync(path.join(dir, backups.shift()));
}

function isKnownSection(manifest, key) {
  return !!(manifest.projects && manifest.projects[key]) || FLAT_SECTIONS.includes(key);
}
function sectionImages(manifest, key) {
  if (manifest.projects && manifest.projects[key]) return manifest.projects[key].images;
  if (FLAT_SECTIONS.includes(key)) { manifest[key] = manifest[key] || []; return manifest[key]; }
  return null;
}
function sectionDir(key) {
  return FLAT_SECTIONS.includes(key) ? path.join(IMAGES_ROOT, key) : path.join(IMAGES_ROOT, 'projects', key);
}
function sectionUrlPrefix(key) {
  return FLAT_SECTIONS.includes(key) ? 'images/' + key + '/' : 'images/projects/' + key + '/';
}

function safeJoin(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Path escapes allowed root');
  return resolved;
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 60 * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function writeImageFile(destPath, buffer) {
  if (sharp) {
    const out = await sharp(buffer).rotate().resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    fs.writeFileSync(destPath, out);
  } else {
    fs.writeFileSync(destPath, buffer);
  }
}

function nextFilename(existingCount, ext) {
  return String(existingCount + 1).padStart(3, '0') + ext;
}

function serveStatic(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) { send(res, 404, { error: 'Not found' }); return; }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const routes = {
  'GET /admin/api/manifest': async (req, res) => {
    send(res, 200, readManifest());
  },

  'POST /admin/api/caption': async (req, res, body) => {
    const { sectionKey, index, cap } = body;
    const manifest = readManifest();
    if (!isKnownSection(manifest, sectionKey)) return send(res, 400, { error: 'Unknown section' });
    const images = sectionImages(manifest, sectionKey);
    if (!images[index]) return send(res, 400, { error: 'Bad index' });
    images[index].cap = String(cap || '');
    writeManifest(manifest);
    send(res, 200, { ok: true });
  },

  'POST /admin/api/reorder': async (req, res, body) => {
    const { sectionKey, fromIndex, toIndex } = body;
    const manifest = readManifest();
    if (!isKnownSection(manifest, sectionKey)) return send(res, 400, { error: 'Unknown section' });
    const images = sectionImages(manifest, sectionKey);
    if (!images[fromIndex]) return send(res, 400, { error: 'Bad index' });
    const [item] = images.splice(fromIndex, 1);
    images.splice(Math.max(0, Math.min(toIndex, images.length)), 0, item);
    writeManifest(manifest);
    send(res, 200, { ok: true });
  },

  'POST /admin/api/delete-image': async (req, res, body) => {
    const { sectionKey, index } = body;
    const manifest = readManifest();
    if (!isKnownSection(manifest, sectionKey)) return send(res, 400, { error: 'Unknown section' });
    const images = sectionImages(manifest, sectionKey);
    const item = images[index];
    if (!item) return send(res, 400, { error: 'Bad index' });
    images.splice(index, 1);
    writeManifest(manifest);
    try {
      const dir = sectionDir(sectionKey);
      const filePath = safeJoin(IMAGES_ROOT, path.relative(IMAGES_ROOT, path.join(ROOT, item.src)));
      if (filePath.startsWith(dir + path.sep)) fs.unlinkSync(filePath);
    } catch (e) { /* file already gone / mismatched path — ignore */ }
    send(res, 200, { ok: true });
  },

  'POST /admin/api/move-image': async (req, res, body) => {
    const { fromSection, index, toSection } = body;
    const manifest = readManifest();
    if (!isKnownSection(manifest, fromSection) || !isKnownSection(manifest, toSection)) {
      return send(res, 400, { error: 'Unknown section' });
    }
    const fromImages = sectionImages(manifest, fromSection);
    const item = fromImages[index];
    if (!item) return send(res, 400, { error: 'Bad index' });

    const fromDir = sectionDir(fromSection);
    const toDir = sectionDir(toSection);
    fs.mkdirSync(toDir, { recursive: true });

    const srcPath = safeJoin(IMAGES_ROOT, path.relative(IMAGES_ROOT, path.join(ROOT, item.src)));
    let destName = path.basename(srcPath);
    let destPath = safeJoin(toDir, destName);
    if (fs.existsSync(destPath)) {
      const ext = path.extname(destName);
      destName = nextFilename(sectionImages(manifest, toSection).length, ext);
      destPath = safeJoin(toDir, destName);
    }
    if (srcPath.startsWith(fromDir + path.sep) && fs.existsSync(srcPath)) fs.renameSync(srcPath, destPath);

    fromImages.splice(index, 1);
    const toImages = sectionImages(manifest, toSection);
    toImages.push({ src: sectionUrlPrefix(toSection) + destName, cap: item.cap || '' });
    writeManifest(manifest);
    send(res, 200, { ok: true });
  },

  'POST /admin/api/upload': async (req, res, body) => {
    const { sectionKey, filename, dataBase64 } = body;
    const manifest = readManifest();
    if (!isKnownSection(manifest, sectionKey)) return send(res, 400, { error: 'Unknown section' });
    if (!dataBase64 || !filename) return send(res, 400, { error: 'Missing file data' });

    const extIn = (path.extname(filename) || '.jpg').toLowerCase();
    const ext = sharp ? '.jpg' : (['.jpg', '.jpeg', '.png', '.webp'].includes(extIn) ? extIn : '.jpg');
    const dir = sectionDir(sectionKey);
    fs.mkdirSync(dir, { recursive: true });

    const images = sectionImages(manifest, sectionKey);
    const name = nextFilename(images.length, ext);
    const destPath = safeJoin(dir, name);
    const buffer = Buffer.from(dataBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');

    await writeImageFile(destPath, buffer);

    images.push({ src: sectionUrlPrefix(sectionKey) + name, cap: '' });
    writeManifest(manifest);
    send(res, 200, { ok: true, src: sectionUrlPrefix(sectionKey) + name, resized: !!sharp });
  },

  'POST /admin/api/create-project': async (req, res, body) => {
    const { key, title, password, about } = body;
    if (!key || !KEY_RE.test(key)) return send(res, 400, { error: 'Invalid key — use lowercase letters, numbers and hyphens' });
    if (!title) return send(res, 400, { error: 'Title required' });
    const manifest = readManifest();
    if (isKnownSection(manifest, key)) return send(res, 400, { error: 'A section with this key already exists' });

    manifest.projects = manifest.projects || {};
    const entry = { title, password: !!(password && password.enabled), images: [] };
    if (entry.password) entry.password_value = String(password.value || '');
    if (about && about.paragraphs && about.paragraphs.length) entry.about = { title: about.title || title, paragraphs: about.paragraphs };
    manifest.projects[key] = entry;
    fs.mkdirSync(sectionDir(key), { recursive: true });
    writeManifest(manifest);
    send(res, 200, { ok: true, key });
  }
};

async function handleAdminRequest(req, res, pathname) {
  if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
    return serveStatic(res, path.join(__dirname, 'index.html'));
  }
  const routeKey = req.method + ' ' + pathname;
  if (routes[routeKey]) {
    const body = req.method === 'POST' ? await readBody(req) : null;
    return routes[routeKey](req, res, body);
  }
  send(res, 404, { error: 'Not found' });
}

module.exports = { handleAdminRequest, sharpAvailable: !!sharp };
