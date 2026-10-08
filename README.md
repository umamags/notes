# Folio

A fast, quiet, private notebook for people with hundreds of notes — architecture work, article research,
PDFs, personal notes and quick ideas. React front end, a single small PHP back end, **plain files on disk, no database,
no AI of any kind**.

## Run it

Requirements: PHP 8.1+ (with `curl`, `fileinfo`, `zip` extensions) and Node 18+ (only needed to build).

```bash
npm install
npm run build        # compiles the React app into public/
npm run serve        # http://127.0.0.1:8080  (PHP's built-in server, 64 MB uploads)
```

or `./start.sh`. For development with hot reload: `npm run serve` in one terminal, `npm run dev` in another.

**Apache / nginx:** point the document root at `public/`. `public/.htaccess` handles routing on Apache; on nginx send
`/api/*` to `public/api/index.php` and everything else to `index.html`. Raise `upload_max_filesize` / `post_max_size`
for large PDFs (`public/.user.ini` sets 128 MB for PHP-FPM).

**Data location:** `storage/` next to the project, or set `FOLIO_STORAGE=/path/to/data`. Keep it writable by PHP and
outside the web root if you can (it contains an `.htaccess` deny file as a fallback). Back up that one folder and you have everything.

> Folio has **no login**. Run it on localhost, or put it behind HTTP basic auth / a VPN before exposing it.

## What's in the box

| Need | How Folio does it |
| --- | --- |
| Page notes + Markdown | CodeMirror editor, live Write / Split / Read modes, tables, task lists, code highlighting, callouts, `[[wiki links]]` |
| Fast switching | `Ctrl/⌘ K` quick switcher (instant fuzzy title match + full-text), tabs, virtualised lists that stay quick with thousands of notes |
| Home | Quick capture, pinned notes, recent notes by day, reading queue, notebooks, tags |
| Universal search | Titles, bodies, tags, collected sources and **text inside imported PDFs**. Operators: `tag:` `in:` `type:` `is:pinned` `has:pdf` `status:` `before:` `after:` `"phrases"` `-exclude` |
| Research notes | Collect links (title/site fetched for you), quotes, screenshots, PDFs, text; reading status, source, author |
| Backlinks | Write `[[Title]]`; the Links panel lists backlinks and unlinked mentions; renames update links elsewhere |
| PDF import | Drop or pick a PDF: stored as-is, thumbnail + text extracted in your browser, searchable |
| Version history | Automatic snapshots after pauses, named checkpoints (`Ctrl/⌘ S`), line diff, preview, restore (current state is saved first) |
| Export | Note → Markdown / HTML / text / JSON / PDF (print); notebook or everything → `.zip` of Markdown + attachments + JSON backup |
| Organisation | Nested notebooks, tags, pinned notes, trash with restore |

Press `?` in the app for all keyboard shortcuts.

## Storage layout

```
storage/
  notes/<id>.json          one file per note
  versions/<noteId>/…      history snapshots
  files/<id>.pdf|png|…     uploads (+ .json metadata, .txt extracted PDF text)
  notebooks.json  settings.json
  index.json               rebuildable metadata cache (Settings → Rebuild index)
```

## Notes on design

- Writes are atomic (temp file + rename) and locked; edits carry a revision number so a stale tab can't silently overwrite newer work.
- Mutating requests need an `X-Requested-With` header (basic CSRF guard); link fetching refuses private/internal addresses; uploads are type-checked and served with `nosniff`.
- Search is a plain server-side scan with scoring — comfortable into the low thousands of notes, no index to corrupt.

## Known limits

- Single user, no authentication (see above).
- PDF export uses the browser's print dialog ("Save as PDF"); there is no `.docx` export.
- Link previews need outbound network access from the PHP server.
