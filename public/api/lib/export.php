<?php
declare(strict_types=1);

/** Markdown + zip exports. Everything is plain text/files — no proprietary formats. */

function notebook_path(array $notebooks, ?string $id): array
{
    $byId = [];
    foreach ($notebooks as $nb) { $byId[$nb['id']] = $nb; }
    $parts = [];
    $guard = 0;
    while ($id !== null && isset($byId[$id]) && $guard++ < 12) {
        array_unshift($parts, safe_name($byId[$id]['name'], 'Notebook'));
        $id = $byId[$id]['parent'];
    }
    return $parts;
}

function rewrite_asset_links(Store $store, string $md, string $prefix, array &$assets): string
{
    return preg_replace_callback(
        '#(?:\./|/)?api/files/([a-z0-9]{6,32})(?:\?[^\s)"\']*)?#',
        function ($m) use ($store, $prefix, &$assets) {
            $meta = $store->fileMeta($m[1]);
            if (!$meta) { return $m[0]; }
            $assets[$meta['id']] = $meta;
            return $prefix . 'assets/' . $meta['id'] . '.' . $meta['ext'];
        },
        $md
    ) ?? $md;
}

function clips_to_markdown(Store $store, array $clips, string $prefix, array &$assets): string
{
    if (!$clips) { return ''; }
    $out = ["## Collected sources\n"];
    foreach ($clips as $c) {
        switch ($c['kind']) {
            case 'link':
                $title = $c['title'] !== '' ? $c['title'] : $c['url'];
                $line = '- [' . str_replace(['[', ']'], ['\\[', '\\]'], $title) . '](' . $c['url'] . ')';
                if ($c['site'] !== '') { $line .= ' — ' . $c['site']; }
                $out[] = $line;
                if ($c['description'] !== '') { $out[] = '  ' . str_replace("\n", ' ', $c['description']); }
                if ($c['comment'] !== '') { $out[] = '  *My note:* ' . str_replace("\n", ' ', $c['comment']); }
                $out[] = '';
                break;
            case 'quote':
                $lines = preg_split('/\R/u', trim($c['text'])) ?: [];
                $out[] = implode("\n", array_map(fn($l) => '> ' . $l, $lines));
                $attr = [];
                if ($c['source'] !== '') { $attr[] = $c['source']; }
                if ($c['page'] !== '') { $attr[] = 'p. ' . $c['page']; }
                if ($attr || $c['url'] !== '') {
                    $a = '> — ' . implode(', ', $attr);
                    if ($c['url'] !== '') { $a .= ($attr ? ' ' : '') . '(' . $c['url'] . ')'; }
                    $out[] = $a;
                }
                if ($c['comment'] !== '') { $out[] = "\n*My note:* " . $c['comment']; }
                $out[] = '';
                break;
            case 'image':
                $meta = $store->fileMeta($c['file']);
                if ($meta) {
                    $assets[$meta['id']] = $meta;
                    $out[] = '![' . str_replace(["\n", ']'], [' ', ''], $c['caption']) . '](' . $prefix . 'assets/' . $meta['id'] . '.' . $meta['ext'] . ')';
                    if ($c['caption'] !== '') { $out[] = '*' . str_replace("\n", ' ', $c['caption']) . '*'; }
                    $out[] = '';
                }
                break;
            case 'pdf':
                $meta = $store->fileMeta($c['file']);
                if ($meta) {
                    $assets[$meta['id']] = $meta;
                    $name = $c['name'] !== '' ? $c['name'] : $meta['name'];
                    $out[] = '- 📄 [' . $name . '](' . $prefix . 'assets/' . $meta['id'] . '.' . $meta['ext'] . ')';
                    if ($c['comment'] !== '') { $out[] = '  *My note:* ' . str_replace("\n", ' ', $c['comment']); }
                    $out[] = '';
                }
                break;
            case 'text':
                $out[] = trim($c['text']);
                $out[] = '';
                break;
        }
    }
    return implode("\n", $out);
}

/** ToDo items as a Markdown task list; item notes are indented under their task. */
function todo_to_markdown(array $items): string
{
    $lines = [];
    foreach ($items as $it) {
        $meta = [];
        if ($it['status'] === 'in-progress') { $meta[] = 'in progress'; }
        if ($it['priority'] !== 'medium') { $meta[] = $it['priority'] . ' priority'; }
        $line = '- [' . ($it['status'] === 'done' ? 'x' : ' ') . '] ' . $it['text'];
        if ($meta) { $line .= ' _(' . implode(', ', $meta) . ')_'; }
        $lines[] = $line;
        if (trim($it['notes']) !== '') {
            foreach (explode("\n", rtrim($it['notes'])) as $l) { $lines[] = '    ' . $l; }
        }
    }
    return implode("\n", $lines);
}

function note_to_markdown(Store $store, array $note, array $notebooks, string $prefix, array &$assets): string
{
    $fm = ['---'];
    $fm[] = 'title: ' . json_encode($note['title'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $fm[] = 'type: ' . $note['type'];
    $nbPath = notebook_path($notebooks, $note['notebook']);
    if ($nbPath) { $fm[] = 'notebook: ' . json_encode(implode(' / ', $nbPath), JSON_UNESCAPED_UNICODE); }
    if ($note['tags']) { $fm[] = 'tags: [' . implode(', ', $note['tags']) . ']'; }
    if (!empty($note['pinned'])) { $fm[] = 'pinned: true'; }
    if (!empty($note['status'])) { $fm[] = 'status: ' . $note['status']; }
    foreach (['url', 'author', 'site', 'published'] as $k) {
        if (!empty($note['source'][$k])) {
            $fm[] = 'source_' . $k . ': ' . json_encode($note['source'][$k], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
    }
    $fm[] = 'created: ' . format_iso((int) $note['created']);
    $fm[] = 'updated: ' . format_iso((int) $note['updated']);
    $fm[] = '---';

    $body = $note['type'] === 'todo'
        ? todo_to_markdown($note['items'])
        : rewrite_asset_links($store, (string) $note['body'], $prefix, $assets);
    $title = $note['title'] !== '' ? '# ' . $note['title'] . "\n\n" : '';
    $sources = $note['type'] === 'research' ? clips_to_markdown($store, $note['clips'], $prefix, $assets) : '';
    return implode("\n", $fm) . "\n\n" . $title . rtrim($body) . "\n" . ($sources !== '' ? "\n" . rtrim($sources) . "\n" : '');
}

function send_download(string $path, string $name, string $mime, bool $deleteAfter = false): never
{
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
    header('Cache-Control: no-store');
    readfile($path);
    if ($deleteAfter) { @unlink($path); }
    exit;
}

function export_note(Store $store, array $note): never
{
    $notebooks = $store->notebooks();
    $assets = [];
    $md = note_to_markdown($store, $note, $notebooks, '', $assets);
    $base = safe_name($note['title'], 'Untitled');
    if (!$assets) {
        $tmp = tempnam(sys_get_temp_dir(), 'folio');
        file_put_contents($tmp, $md);
        send_download($tmp, $base . '.md', 'text/markdown; charset=utf-8', true);
    }
    $tmp = tempnam(sys_get_temp_dir(), 'folio');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);
    $zip->addFromString($base . '.md', $md);
    foreach ($assets as $meta) {
        $zip->addFile($store->filePath($meta), 'assets/' . $meta['id'] . '.' . $meta['ext']);
    }
    $zip->close();
    send_download($tmp, $base . '.zip', 'application/zip', true);
}

function export_many(Store $store, array $notes, string $zipName, bool $withBackup): never
{
    $notebooks = $store->notebooks();
    $tmp = tempnam(sys_get_temp_dir(), 'folio');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);
    $assets = [];
    $used = [];
    $root = pathinfo($zipName, PATHINFO_FILENAME);

    foreach ($notes as $note) {
        $dirs = notebook_path($notebooks, $note['notebook']);
        $prefix = str_repeat('../', count($dirs));
        $md = note_to_markdown($store, $note, $notebooks, $prefix, $assets);
        $dir = $root . '/' . ($dirs ? implode('/', $dirs) . '/' : '');
        $base = safe_name($note['title'], 'Untitled');
        $name = $dir . $base;
        $n = 2;
        while (isset($used[mb_strtolower($name)])) {
            $name = $dir . $base . ' (' . $n++ . ')';
        }
        $used[mb_strtolower($name)] = true;
        $zip->addFromString($name . '.md', $md);
    }
    foreach ($assets as $meta) {
        $zip->addFile($store->filePath($meta), $root . '/assets/' . $meta['id'] . '.' . $meta['ext']);
    }
    if ($withBackup) {
        $zip->addFromString($root . '/folio-backup.json', json_encode([
            'app' => 'folio', 'version' => 1, 'exportedAt' => format_iso(now_ms()),
            'notebooks' => $notebooks, 'notes' => $notes,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE));
    }
    $zip->close();
    send_download($tmp, $zipName, 'application/zip', true);
}
