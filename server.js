// Single entry point for the whole site: public pages at "/", admin panel
// at "/admin" (HTTP Basic Auth protected). This is what you deploy — any
// host that can run `node server.js` and point your domain at it works.
//
// First run auto-generates admin credentials and prints them ONCE. To do
// that without starting the server, run:  node server.js --init-creds
//
// In production, prefer setting ADMIN_USER / ADMIN_PASS as environment
// variables in your host's dashboard instead of relying on the local
// admin/.credentials.json file.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleAdminRequest, sharpAvailable } = require('./admin/api.js');
const { ensureCredentials, requireBasicAuth, CREDS_PATH } = require('./admin/auth.js');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function safeJoin(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Path escapes root');
  return resolved;
}

function serveStatic(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function printFreshCredentials(result) {
  console.log('\n=== Admin credentials generated (first run) ===');
  console.log('  Username: ' + result.username);
  console.log('  Password: ' + result.password);
  console.log('Save this password now — it will not be shown again.');
  console.log('Delete admin/.credentials.json (or rerun with --force) to regenerate.\n');
}

// ── CLI mode: initialize/print credential status without starting a server ──
if (process.argv.includes('--init-creds')) {
  if (process.argv.includes('--force') && fs.existsSync(CREDS_PATH)) fs.unlinkSync(CREDS_PATH);
  const result = ensureCredentials();
  if (result.source === 'env') {
    console.log('ADMIN_USER / ADMIN_PASS environment variables are set — using those, no local file needed.');
  } else if (result.password) {
    printFreshCredentials(result);
  } else {
    console.log('Credentials already initialized for username: ' + result.username);
    console.log('Run with --force to regenerate (invalidates the old password).');
  }
  process.exit(0);
}

// ── normal boot ──
const credsResult = ensureCredentials();
if (credsResult.password) printFreshCredentials(credsResult);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      if (!requireBasicAuth(req, res)) return;
      return await handleAdminRequest(req, res, pathname);
    }

    if (pathname.includes('..')) { res.writeHead(400); res.end('Bad request'); return; }
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const absPath = safeJoin(ROOT, rel);
    return serveStatic(res, absPath);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'Server error' }));
  }
});

server.listen(PORT, () => {
  console.log('Site running at        http://localhost:' + PORT + '/');
  console.log('Admin panel running at http://localhost:' + PORT + '/admin  (Basic Auth required)');
  console.log(sharpAvailable ? 'Image resizing/compression: ON (sharp found)' : 'Image resizing/compression: OFF (sharp not installed — uploads stored as-is)');
});
