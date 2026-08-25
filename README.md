# Max Badikov — Photography Site

A single-page photography portfolio (`index.html` + `manifest.json`) with a small admin panel (`/admin`) for managing photos, projects and captions without touching code.

## Project structure

```
index.html          the public site (all pages, hash-routed: #/, #/about, #/gallery/<key>, #/index/<key>)
manifest.json        all content: projects, galleries, image paths, captions
images/               photo files, organized by section (created as you upload)
robots.txt / sitemap.xml   SEO files (sitemap has a placeholder domain — see "Going live" below)
server.js             the server you run — serves the public site AND the admin panel
admin/                admin panel: index.html (UI), api.js (routes), auth.js (login)
```

## Running it locally

Requires [Node.js](https://nodejs.org) (v18+).

```bash
npm install     # first time only — installs sharp, used to compress uploaded photos
npm start       # starts the server
```

Then open:
- **Public site:** http://localhost:8080/
- **Admin panel:** http://localhost:8080/admin

The port can be changed with `PORT=3000 npm start`.

> You can also just open `index.html` directly in a browser (double-click it) to preview the public site with no server running — the admin panel needs the server, though.

## Using the admin panel

Go to `/admin` and log in (see "Admin credentials" below). From there you can, per section (each project, plus Commissioned/Portraits/Personal):

- **Upload photos** — drag files onto the dropzone, or click it to choose files. Photos are automatically resized/compressed on upload.
- **Edit captions** — type in the caption field under a photo, it saves when you click away or press Enter.
- **Reorder photos** — drag a photo onto another one to swap its position.
- **Move a photo to a different section** — use the "Move to…" dropdown on the photo.
- **Delete a photo** — click the × on it (asks for confirmation; removes the file too).
- **Create a new project** — click "+ New Project" in the sidebar. Give it a title (the URL key auto-fills, editable), optionally password-protect it, and optionally add "About" text — one paragraph per line. To make a line a clickable link, write it as `[Link text](https://example.com)`.

Every change is saved immediately (no separate "Save" step), and a timestamped backup of `manifest.json` is kept automatically (last 5 backups) in case anything needs reverting.

## Admin credentials

The admin panel is protected by a username/password (HTTP Basic Auth — your browser will prompt for it).

**First run:** if no credentials exist yet, starting the server auto-generates one and prints it **once** to the terminal:

```bash
npm start
# === Admin credentials generated (first run) ===
#   Username: admin
#   Password: <random password>
```

Save that password somewhere safe (e.g. a password manager) — it's stored on disk only as a salted hash (`admin/.credentials.json`), never in plain text, so it can't be shown again.

**To check/initialize credentials without starting the server:**
```bash
npm run init-creds
```

**To reset the password** (invalidates the old one):
```bash
rm admin/.credentials.json
npm run init-creds
```

**For production, prefer environment variables** instead of the local file — set `ADMIN_USER` and `ADMIN_PASS` in your hosting provider's dashboard. If both are set, they take priority over `admin/.credentials.json` and nothing sensitive is written to disk at all.

## Going live (deployment)

This needs a host that can run a persistent Node process with writable disk (the admin panel writes uploaded photos and `manifest.json` to disk) — e.g. Render, Railway, Fly.io, or a VPS. A static-only host (like plain GitHub Pages) won't work for the admin panel, only for the public pages.

1. Deploy this folder; the start command is `npm install && npm start` (or `node server.js`).
2. Set `PORT` if your host requires a specific one (most set it automatically).
3. Set `ADMIN_USER` and `ADMIN_PASS` as environment variables in your host's dashboard (recommended over the auto-generated local file for a real deployment).
4. Make sure your domain serves **HTTPS** (virtually every modern host does this automatically) — Basic Auth sends credentials in a way that's only safe over an encrypted connection.
5. Once you have a live domain, update the placeholder in `sitemap.xml` (`https://REPLACE-WITH-LIVE-DOMAIN.example/`) and consider adding `<link rel="canonical">` / `og:url` tags in `index.html` (marked with a `TODO` comment in the `<head>`).

## Notes

- Never expose the admin panel over plain HTTP in production — only HTTPS.
- `admin/.credentials.json` and `manifest.json.bak-*` backup files are gitignored — don't commit them if you version-control this project.
