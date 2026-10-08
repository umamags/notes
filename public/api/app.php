<?php
declare(strict_types=1);

/**
 * Folio API — a single PHP entry point. JSON in, JSON out. No database: everything is files.
 * Configure the storage location with the FOLIO_STORAGE environment variable (defaults to ../storage).
 */

// Check if required lib files exist
$requiredFiles = [
    'lib/util.php',
    'lib/store.php',
    'lib/search.php',
    'lib/unfurl.php',
    'lib/files.php',
    'lib/export.php',
    'lib/seed.php',
];

foreach ($requiredFiles as $file) {
    $path = __DIR__ . '/' . $file;
    if (!is_file($path)) {
        http_response_code(500);
        header('Content-Type: application/json');
        die(json_encode([
            'error' => "Missing required file: $file",
            'path' => $path,
            'currentDir' => __DIR__,
            'filesInDir' => scandir(__DIR__),
        ]));
    }
}

require __DIR__ . '/lib/util.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/search.php';
require __DIR__ . '/lib/unfurl.php';
require __DIR__ . '/lib/files.php';
require __DIR__ . '/lib/export.php';
require __DIR__ . '/lib/seed.php';

mb_internal_encoding('UTF-8');
ini_set('display_errors', '0');
set_error_handler(function (int $no, string $str, string $file, int $line): bool {
    if (!(error_reporting() & $no)) { return false; }
    throw new ErrorException($str, 0, $no, $file, $line);
});
set_exception_handler(function (Throwable $e): void {
    $msg = $e->getMessage();
    $file = $e->getFile();
    $line = $e->getLine();
    error_log("[folio] $msg @ $file:$line");
    if (!headers_sent()) {
        send_json([
            'error' => "Server error: $msg",
            'type' => class_basename($e),
            'file' => $file,
            'line' => $line,
        ], 500);
    }
});

// Determine storage path based on environment
if ($env = getenv('FOLIO_STORAGE')) {
    $storageRoot = $env;
} else {
    $host = strtolower($_SERVER['HTTP_HOST'] ?? 'localhost');
    // For ai-lab.in, use shared data directory outside project
    if (strpos($host, 'ai-lab.in') !== false) {
        $storageRoot = realpath(__DIR__ . '/../..') . '/data/notes';
    } else {
        // For localhost and development, use project-local storage
        $storageRoot = __DIR__ . '/../storage';
    }
}
$store = new Store($storageRoot);

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$uriPath = rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));
$pos = strpos($uriPath, '/api/');
$route = $pos === false ? '' : trim(substr($uriPath, $pos + 5), '/');
$seg = $route === '' ? [] : explode('/', $route);
$q = $_GET;

// Light CSRF guard: state-changing requests must carry a custom header (cross-site forms cannot set it).
if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'folio') {
        fail(403, 'Missing X-Requested-With header');
    }
}

function ini_bytes(string $key): int
{
    $v = trim((string) ini_get($key));
    if ($v === '') { return 0; }
    $n = (int) $v;
    return match (strtolower(substr($v, -1))) { 'g' => $n << 30, 'm' => $n << 20, 'k' => $n << 10, default => $n };
}

const CONTENT_KEYS = ['title', 'body', 'clips', 'tags', 'source', 'type', 'status'];

function content_changed(array $a, array $b): bool
{
    foreach (CONTENT_KEYS as $k) {
        if (($a[$k] ?? null) != ($b[$k] ?? null)) { return true; }
    }
    return false;
}

/** When a note is renamed, rewrite [[wiki links]] that pointed at the old title. */
function propagate_rename(Store $store, string $noteId, string $old, string $new): array
{
    $old = trim($old);
    $new = trim($new);
    if ($old === '' || $new === '' || mb_strtolower($old) === mb_strtolower($new) && $old === $new) {
        return [];
    }
    foreach ($store->loadIndex() as $id => $e) {   // ambiguous (duplicate) titles are left alone
        if ($id !== $noteId && empty($e['trashed']) && mb_strtolower($e['title']) === mb_strtolower($old)) {
            return [];
        }
    }
    $touched = [];
    $lower = mb_strtolower($old);
    $pattern = '/\[\[\s*' . preg_quote($old, '/') . '\s*(#[^\]\|]*)?(\|[^\]]*)?\]\]/iu';
    foreach ($store->loadIndex() as $id => $e) {
        if ($id === $noteId) { continue; }
        $links = array_map('mb_strtolower', (array) $e['links']);
        if (!in_array($lower, $links, true)) { continue; }
        $other = $store->readNote((string) $id);
        if (!$other) { continue; }
        $body = preg_replace_callback($pattern, fn($m) => '[[' . $new . ($m[1] ?? '') . ($m[2] ?? '') . ']]', $other['body']);
        if ($body !== null && $body !== $other['body']) {
            $other['body'] = $body;                 // deliberately keeps `updated` untouched
            $touched[] = $store->persist($other);
        }
    }
    return $touched;
}

// ------------------------------------------------------------------ routing

switch ($seg[0] ?? '') {

    case 'bootstrap':
        $store->locked(function () use ($store) {
            $marker = $store->path('.initialized');
            if (!is_file($marker)) {
                if (count($store->loadIndex()) === 0) {
                    seed_sample($store);
                }
                file_put_contents($marker, (string) now_ms());
            }
        });
        $index = $store->loadIndex();
        send_json([
            'notes' => array_values($index),
            'notebooks' => $store->notebooks(),
            'settings' => $store->settings(),
            'server' => [
                'maxUpload' => min(ini_bytes('upload_max_filesize') ?: PHP_INT_MAX, ini_bytes('post_max_size') ?: PHP_INT_MAX),
                'php' => PHP_VERSION,
                'storage' => realpath($store->root()) ?: $store->root(),
            ],
        ]);

    case 'settings':
        if ($method === 'PUT') {
            send_json($store->saveSettings(body_json()));
        }
        send_json($store->settings());

    // ------------------------------------------------------------ notes
    case 'notes':
        $id = $seg[1] ?? null;

        if ($id === null) {
            if ($method !== 'POST') { fail(405, 'Method not allowed'); }
            $in = body_json();
            $result = $store->locked(function () use ($store, $in) {
                $note = $store->newNote($in);
                $entry = $store->persist($note);
                return ['note' => $note, 'entry' => $entry];
            });
            send_json($result, 201);
        }

        if ($id === 'bulk') {
            if ($method !== 'POST') { fail(405, 'Method not allowed'); }
            $in = body_json();
            $entries = $store->locked(function () use ($store, $in) {
                $out = [];
                foreach (array_slice((array) ($in['notes'] ?? []), 0, 500) as $n) {
                    if (is_array($n)) {
                        $out[] = $store->persist($store->newNote($n));
                    }
                }
                return $out;
            });
            send_json(['entries' => $entries], 201);
        }

        if (!valid_id($id)) { fail(404, 'Not found'); }
        $sub = $seg[2] ?? null;

        // ---- /notes/{id}
        if ($sub === null) {
            if ($method === 'GET') {
                $note = $store->readNote($id) ?? fail(404, 'Note not found');
                send_json($note);
            }
            if ($method === 'PUT') {
                $in = body_json();
                $result = $store->locked(function () use ($store, $id, $in) {
                    $note = $store->readNote($id) ?? fail(404, 'Note not found');
                    $before = $note;
                    $after = $store->applyPatch($note, $in);
                    $touchesContent = false;
                    foreach (['title', 'body', 'clips'] as $k) { if (array_key_exists($k, $in)) { $touchesContent = true; } }
                    if ($touchesContent && isset($in['baseRev']) && empty($in['force'])
                        && (int) ($before['rev'] ?? 0) !== (int) $in['baseRev'] && content_changed($before, $after)) {
                        fail(409, 'This note was changed somewhere else', ['note' => $before]);
                    }
                    $changed = content_changed($before, $after);
                    if ($changed) {
                        $after['updated'] = now_ms();
                        $store->maybeSnapshotBefore($before, $after);
                    }
                    if (isset($in['pinned']) && (bool) $in['pinned'] !== (bool) $before['pinned']) { $after['pinned'] = (bool) $in['pinned']; }
                    $bump = $before['title'] !== $after['title'] || $before['body'] !== $after['body'] || $before['clips'] != $after['clips'];
                    $entry = $store->persist($after, $bump);
                    $touched = [];
                    if ($before['title'] !== $after['title']) {
                        $touched = propagate_rename($store, $id, $before['title'], $after['title']);
                    }
                    return ['entry' => $entry, 'updated' => $after['updated'], 'rev' => $entry['rev'], 'touched' => $touched];
                });
                send_json($result);
            }
            if ($method === 'DELETE') {
                $result = $store->locked(function () use ($store, $id, $q) {
                    $note = $store->readNote($id) ?? fail(404, 'Note not found');
                    if (!empty($q['permanent']) || !empty($note['trashed'])) {
                        $store->removeNote($id);
                        return ['deleted' => true];
                    }
                    $note['trashed'] = true;
                    $note['trashedAt'] = now_ms();
                    return ['entry' => $store->persist($note, false)];
                });
                send_json($result);
            }
            fail(405, 'Method not allowed');
        }

        if ($sub === 'restore' && $method === 'POST') {
            $entry = $store->locked(function () use ($store, $id) {
                $note = $store->readNote($id) ?? fail(404, 'Note not found');
                $note['trashed'] = false;
                $note['trashedAt'] = null;
                if (!$store->notebookExists($note['notebook'])) { $note['notebook'] = 'inbox'; }
                return $store->persist($note, false);
            });
            send_json(['entry' => $entry]);
        }

        if ($sub === 'duplicate' && $method === 'POST') {
            $result = $store->locked(function () use ($store, $id) {
                $src = $store->readNote($id) ?? fail(404, 'Note not found');
                $copy = $src;
                $copy['id'] = new_id(10);
                $copy['title'] = trim($src['title'] . ' (copy)');
                $copy['pinned'] = false;
                $copy['trashed'] = false;
                $copy['created'] = $copy['updated'] = now_ms();
                unset($copy['sample']);
                $entry = $store->persist($copy);
                return ['note' => $copy, 'entry' => $entry];
            });
            send_json($result, 201);
        }

        if ($sub === 'links' && $method === 'GET') {
            $note = $store->readNote($id) ?? fail(404, 'Note not found');
            send_json(note_links($store, $note, !empty($q['mentions'])));
        }

        if ($sub === 'versions') {
            $store->readNote($id) ?? fail(404, 'Note not found');
            $vid = $seg[3] ?? null;
            if ($vid === null) {
                if ($method === 'GET') { send_json(['versions' => $store->listVersions($id)]); }
                if ($method === 'POST') {
                    $in = body_json();
                    $v = $store->locked(function () use ($store, $id, $in) {
                        $note = $store->readNote($id);
                        return $store->snapshot($note, (string) ($in['label'] ?? ''));
                    });
                    send_json(['version' => ['id' => $v['id'], 'at' => $v['at'], 'label' => $v['label'], 'title' => $v['title'], 'words' => $v['words'], 'clips' => count($v['clips'])]], 201);
                }
                fail(405, 'Method not allowed');
            }
            if (($seg[4] ?? null) === 'restore' && $method === 'POST') {
                $result = $store->locked(function () use ($store, $id, $vid) {
                    $v = $store->getVersion($id, $vid) ?? fail(404, 'Version not found');
                    $note = $store->readNote($id);
                    $store->snapshot($note, 'Before restore');          // never lose the current state
                    $note['title'] = $v['title'];
                    $note['body'] = $v['body'];
                    $note['tags'] = $v['tags'] ?? $note['tags'];
                    $note['clips'] = $v['clips'] ?? $note['clips'];
                    if (!empty($v['type'])) { $note['type'] = $v['type']; }
                    $note['updated'] = now_ms();
                    $entry = $store->persist($note);
                    return ['note' => $note, 'entry' => $entry];
                });
                send_json($result);
            }
            if ($method === 'GET') { send_json($store->getVersion($id, $vid) ?? fail(404, 'Version not found')); }
            if ($method === 'DELETE') {
                $store->deleteVersion($id, $vid);
                send_json(['ok' => true]);
            }
        }
        fail(404, 'Not found');

    // ------------------------------------------------------------ search
    case 'search':
        $query = trim((string) ($q['q'] ?? ''));
        $limit = max(1, min(200, (int) ($q['limit'] ?? 60)));
        send_json(run_search($store, $query, $limit));

    // ------------------------------------------------------------ notebooks
    case 'notebooks':
        $id = $seg[1] ?? null;
        $result = $store->locked(function () use ($store, $method, $id) {
            $list = $store->notebooks();
            $in = $method === 'GET' ? [] : body_json();
            $colors = ['slate', 'indigo', 'teal', 'rose', 'amber', 'green', 'sky', 'violet'];
            $changedEntries = [];

            if ($method === 'POST' && $id === null) {
                $parent = isset($in['parent']) && $store->notebookExists((string) $in['parent']) ? (string) $in['parent'] : null;
                $order = 0;
                foreach ($list as $nb) { $order = max($order, (int) ($nb['order'] ?? 0)); }
                $nb = [
                    'id' => new_id(8), 'name' => str_clip(trim((string) ($in['name'] ?? 'New notebook')) ?: 'New notebook', 60),
                    'parent' => $parent, 'color' => in_array($in['color'] ?? '', $colors, true) ? $in['color'] : 'slate',
                    'order' => $order + 1, 'created' => now_ms(),
                ];
                $list[] = $nb;
                $store->saveNotebooks($list);
                return ['notebooks' => $list, 'notebook' => $nb];
            }

            if ($id !== null) {
                $idx = null;
                foreach ($list as $i => $nb) { if ($nb['id'] === $id) { $idx = $i; } }
                if ($idx === null) { fail(404, 'Notebook not found'); }

                if ($method === 'PUT') {
                    $nb = $list[$idx];
                    if (isset($in['name']) && trim((string) $in['name']) !== '' && empty($nb['system'])) {
                        $nb['name'] = str_clip(trim((string) $in['name']), 60);
                    }
                    if (isset($in['color']) && in_array($in['color'], $colors, true)) { $nb['color'] = $in['color']; }
                    if (array_key_exists('parent', $in) && empty($nb['system'])) {
                        $p = $in['parent'] === null ? null : (string) $in['parent'];
                        if ($p === null || $store->notebookExists($p)) {
                            $desc = notebook_descendants($list, $id);
                            if ($p === null || !in_array($p, $desc, true)) { $nb['parent'] = $p; }   // no cycles
                        }
                    }
                    if (isset($in['order'])) { $nb['order'] = (int) $in['order']; }
                    $list[$idx] = $nb;
                    $store->saveNotebooks($list);
                    return ['notebooks' => $list, 'notebook' => $nb];
                }

                if ($method === 'DELETE') {
                    if (!empty($list[$idx]['system'])) { fail(400, 'The Inbox cannot be deleted'); }
                    $parent = $list[$idx]['parent'];
                    foreach ($list as $i => $nb) {
                        if ($nb['parent'] === $id) { $list[$i]['parent'] = $parent; }
                    }
                    unset($list[$idx]);
                    $store->saveNotebooks($list);
                    $target = $parent ?? 'inbox';
                    foreach ($store->loadIndex() as $nid => $e) {
                        if ($e['notebook'] === $id) {
                            $note = $store->readNote((string) $nid);
                            if ($note) {
                                $note['notebook'] = $target;
                                $changedEntries[] = $store->persist($note, false);
                            }
                        }
                    }
                    return ['notebooks' => array_values($list), 'entries' => $changedEntries];
                }
            }
            if ($method === 'GET') { return ['notebooks' => $list]; }
            fail(405, 'Method not allowed');
        });
        send_json($result);

    // ------------------------------------------------------------ tags
    case 'tags':
        if ($method !== 'POST' || !in_array($seg[1] ?? '', ['rename', 'delete'], true)) { fail(405, 'Method not allowed'); }
        $in = body_json();
        $from = Store::cleanTags([(string) ($in['from'] ?? '')])[0] ?? '';
        $to = Store::cleanTags([(string) ($in['to'] ?? '')])[0] ?? '';
        if ($from === '') { fail(400, 'Missing tag'); }
        $entries = $store->locked(function () use ($store, $seg, $from, $to) {
            $out = [];
            foreach ($store->loadIndex() as $nid => $e) {
                if (!in_array($from, $e['tags'], true)) { continue; }
                $note = $store->readNote((string) $nid);
                if (!$note) { continue; }
                $tags = array_values(array_filter($note['tags'], fn($t) => $t !== $from));
                if ($seg[1] === 'rename' && $to !== '') { $tags[] = $to; }
                $note['tags'] = Store::cleanTags($tags);
                $out[] = $store->persist($note, false);
            }
            return $out;
        });
        send_json(['entries' => $entries]);

    // ------------------------------------------------------------ trash
    case 'trash':
        if (($seg[1] ?? '') === 'empty' && $method === 'POST') {
            $n = $store->locked(function () use ($store) {
                $count = 0;
                foreach ($store->loadIndex() as $nid => $e) {
                    if (!empty($e['trashed'])) { $store->removeNote((string) $nid); $count++; }
                }
                return $count;
            });
            send_json(['removed' => $n]);
        }
        fail(404, 'Not found');

    // ------------------------------------------------------------ files
    case 'upload':
        if ($method !== 'POST') { fail(405, 'Method not allowed'); }
        handle_upload($store);

    case 'files':
        $fid = $seg[1] ?? '';
        if (!valid_id($fid)) { fail(404, 'Not found'); }
        if (($seg[2] ?? '') === 'text') {
            $store->fileMeta($fid) ?? fail(404, 'File not found');
            if ($method === 'PUT') {
                $in = body_json();
                atomic_write($store->path("files/$fid.txt"), str_clip((string) ($in['text'] ?? ''), 3_000_000));
                send_json(['ok' => true]);
            }
            send_json(['text' => $store->fileText($fid)]);
        }
        serve_file($store, $fid);

    case 'unfurl':
        $url = trim((string) ($q['url'] ?? ''));
        if ($url === '') { fail(400, 'Missing url'); }
        send_json(unfurl_url($store, $url));

    // ------------------------------------------------------------ export
    case 'export':
        $what = $seg[1] ?? '';
        if ($what === 'note') {
            $note = $store->readNote((string) ($seg[2] ?? '')) ?? fail(404, 'Note not found');
            export_note($store, $note);
        }
        if ($what === 'notebook') {
            $nbId = (string) ($seg[2] ?? '');
            $list = $store->notebooks();
            $name = 'Notebook';
            foreach ($list as $nb) { if ($nb['id'] === $nbId) { $name = $nb['name']; } }
            $ids = notebook_descendants($list, $nbId);
            $notes = array_values(array_filter($store->allNotes(), fn($n) => in_array($n['notebook'], $ids, true)));
            export_many($store, $notes, safe_name($name) . '.zip', false);
        }
        if ($what === 'all') {
            export_many($store, $store->allNotes(), 'folio-export-' . date('Y-m-d') . '.zip', true);
        }
        fail(404, 'Not found');

    // ------------------------------------------------------------ maintenance & stats
    case 'maintenance':
        $act = $seg[1] ?? '';
        if ($method !== 'POST') { fail(405, 'Method not allowed'); }
        if ($act === 'reindex') {
            $n = $store->locked(fn() => count($store->rebuildIndex()));
            send_json(['notes' => $n]);
        }
        if ($act === 'remove-samples') {
            $removed = $store->locked(function () use ($store) {
                $count = 0;
                foreach ($store->loadIndex() as $nid => $e) {
                    if (!empty($e['sample'])) { $store->removeNote((string) $nid); $count++; }
                }
                $list = $store->notebooks();
                $keep = [];
                foreach ($list as $nb) {
                    if (empty($nb['sample'])) { $keep[] = $nb; continue; }
                    $parent = $nb['parent'];
                    foreach ($list as $i => $o) { if ($o['parent'] === $nb['id']) { $list[$i]['parent'] = $parent; } }
                    foreach ($store->loadIndex() as $nid => $e) {
                        if ($e['notebook'] === $nb['id']) {
                            $note = $store->readNote((string) $nid);
                            if ($note) { $note['notebook'] = $parent ?? 'inbox'; $store->persist($note, false); }
                        }
                    }
                }
                $final = [];
                foreach ($list as $nb) { if (empty($nb['sample'])) { $final[] = $nb; } }
                $store->saveNotebooks($final);
                return $count;
            });
            send_json(['removed' => $removed, 'notes' => array_values($store->loadIndex()), 'notebooks' => $store->notebooks()]);
        }
        fail(404, 'Not found');

    case 'stats':
        $bytes = 0;
        $files = 0;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($store->root(), FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) { if ($f->isFile()) { $bytes += $f->getSize(); $files++; } }
        $notes = $store->loadIndex();
        send_json([
            'notes' => count(array_filter($notes, fn($e) => empty($e['trashed']))),
            'trashed' => count(array_filter($notes, fn($e) => !empty($e['trashed']))),
            'bytes' => $bytes, 'files' => $files, 'storage' => realpath($store->root()) ?: $store->root(),
        ]);

    case 'health':
        send_json(['ok' => true, 'time' => now_ms()]);

    case 'diagnostics':
        send_json([
            'ok' => true,
            'php' => PHP_VERSION,
            'storage' => $storageRoot ?? 'not initialized',
            'request' => [
                'method' => $method,
                'uri' => $_SERVER['REQUEST_URI'] ?? 'unknown',
                'path' => $uriPath,
                'route' => $route,
                'segments' => $seg,
            ],
            'environment' => [
                'host' => $_SERVER['HTTP_HOST'] ?? 'unknown',
                'scriptName' => $_SERVER['SCRIPT_NAME'] ?? 'unknown',
                'scriptFilename' => $_SERVER['SCRIPT_FILENAME'] ?? 'unknown',
            ],
        ]);

    default:
        fail(404, "Unknown endpoint: $route. Available: bootstrap, notes, notebooks, tags, search, upload, files, unfurl, export, maintenance, stats, health, diagnostics");
}
