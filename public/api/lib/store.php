<?php
declare(strict_types=1);

/**
 * File-based store. Layout (all under the storage root):
 *   notes/<id>.json         one file per note
 *   versions/<id>/*.json    version snapshots
 *   files/<id>.<ext>        uploaded attachments (+ <id>.json meta, <id>.txt extracted text)
 *   index.json              lightweight metadata cache (rebuildable)
 *   notebooks.json          folders
 *   settings.json           UI preferences
 */
final class Store
{
    public const VERSION_GAP_MS = 300000;   // 5 minutes of quiet = new editing session
    public const MAX_VERSIONS = 80;

    private string $root;
    /** @var resource|null */
    private $lockHandle = null;
    private int $lockDepth = 0;
    private ?array $index = null;

    public const DEFAULT_SETTINGS = [
        'theme' => 'system',       // system | light | dark
        'accent' => 'indigo',      // indigo | teal | rose | amber | slate
        'editorFont' => 'sans',    // sans | serif | mono
        'fontSize' => 16,
        'width' => 'normal',       // narrow | normal | wide
        'defaultView' => 'write',  // write | split | read
        'spellcheck' => true,
        'listSort' => 'updated',
    ];

    public function __construct(string $root)
    {
        $this->root = rtrim($root, '/\\');
        foreach (['', 'notes', 'versions', 'files', 'cache'] as $d) {
            $p = $this->root . ($d === '' ? '' : '/' . $d);
            if (!is_dir($p) && !mkdir($p, 0775, true) && !is_dir($p)) {
                throw new RuntimeException("Cannot create storage directory: $p");
            }
        }
        $ht = $this->root . '/.htaccess';
        if (!is_file($ht)) {
            @file_put_contents($ht, "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
        }
    }

    public function root(): string { return $this->root; }
    public function path(string $rel): string { return $this->root . '/' . ltrim($rel, '/'); }

    // ---------------------------------------------------------------- locking

    public function lock(): void
    {
        if ($this->lockDepth === 0) {
            $this->lockHandle = fopen($this->root . '/.lock', 'c');
            if ($this->lockHandle) {
                flock($this->lockHandle, LOCK_EX);
            }
        }
        $this->lockDepth++;
    }

    public function unlock(): void
    {
        $this->lockDepth = max(0, $this->lockDepth - 1);
        if ($this->lockDepth === 0 && $this->lockHandle) {
            flock($this->lockHandle, LOCK_UN);
            fclose($this->lockHandle);
            $this->lockHandle = null;
            $this->index = null; // never trust cached index across lock boundaries
        }
    }

    public function locked(callable $fn): mixed
    {
        $this->lock();
        try {
            return $fn();
        } finally {
            $this->unlock();
        }
    }

    // ---------------------------------------------------------------- settings & notebooks

    public function settings(): array
    {
        $s = read_json($this->path('settings.json'), []);
        return array_replace(self::DEFAULT_SETTINGS, is_array($s) ? $s : []);
    }

    public function saveSettings(array $in): array
    {
        $cur = $this->settings();
        $allowed = [
            'theme' => ['system', 'light', 'dark'],
            'accent' => ['indigo', 'teal', 'rose', 'amber', 'slate'],
            'editorFont' => ['sans', 'serif', 'mono'],
            'width' => ['narrow', 'normal', 'wide'],
            'defaultView' => ['write', 'split', 'read'],
            'listSort' => ['updated', 'created', 'title'],
        ];
        foreach ($allowed as $k => $opts) {
            if (isset($in[$k]) && in_array($in[$k], $opts, true)) {
                $cur[$k] = $in[$k];
            }
        }
        if (isset($in['fontSize'])) {
            $cur['fontSize'] = max(13, min(22, (int) $in['fontSize']));
        }
        if (isset($in['spellcheck'])) {
            $cur['spellcheck'] = (bool) $in['spellcheck'];
        }
        write_json($this->path('settings.json'), $cur);
        return $cur;
    }

    public function notebooks(): array
    {
        $list = read_json($this->path('notebooks.json'), null);
        if (!is_array($list)) {
            $list = [[
                'id' => 'inbox', 'name' => 'Inbox', 'parent' => null, 'color' => 'slate',
                'system' => 'inbox', 'order' => 0, 'created' => now_ms(),
            ]];
            write_json($this->path('notebooks.json'), $list);
        }
        return $list;
    }

    public function saveNotebooks(array $list): void
    {
        write_json($this->path('notebooks.json'), array_values($list));
    }

    public function notebookExists(?string $id): bool
    {
        if ($id === null) {
            return false;
        }
        foreach ($this->notebooks() as $nb) {
            if ($nb['id'] === $id) {
                return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------- notes

    public function notePath(string $id): string { return $this->root . '/notes/' . $id . '.json'; }
    public function versionsDir(string $id): string { return $this->root . '/versions/' . $id; }

    public function readNote(string $id): ?array
    {
        if (!valid_id($id)) {
            return null;
        }
        $n = read_json($this->notePath($id), null);
        return is_array($n) ? $this->withDefaults($n) : null;
    }

    private function withDefaults(array $n): array
    {
        return $n + [
            'title' => '', 'body' => '', 'type' => 'page', 'notebook' => 'inbox', 'tags' => [],
            'pinned' => false, 'trashed' => false, 'trashedAt' => null, 'created' => now_ms(),
            'updated' => now_ms(), 'clips' => [], 'source' => ['url' => '', 'author' => '', 'site' => '', 'published' => ''],
            'status' => '', 'items' => [],
        ];
    }

    public function newNote(array $in): array
    {
        $now = now_ms();
        $note = $this->withDefaults([
            'id' => new_id(10), 'created' => $now, 'updated' => $now,
            'notebook' => 'inbox',
        ]);
        $note = $this->applyPatch($note, $in);
        if (!empty($in['created']) && is_int($in['created'])) {
            $note['created'] = $in['created'];
            $note['updated'] = $in['updated'] ?? $in['created'];
        }
        if (!empty($in['sample'])) {
            $note['sample'] = true;
        }
        return $note;
    }

    /** Whitelist + sanitise incoming fields onto a note. */
    public function applyPatch(array $note, array $in): array
    {
        if (array_key_exists('title', $in)) {
            $note['title'] = str_clip(trim((string) $in['title']), 300);
        }
        if (array_key_exists('body', $in)) {
            $note['body'] = str_clip((string) $in['body'], 2_000_000);
        }
        if (isset($in['type']) && in_array($in['type'], ['page', 'research', 'todo'], true)) {
            $note['type'] = $in['type'];
        }
        if (array_key_exists('notebook', $in)) {
            if ($in['notebook'] === null || $in['notebook'] === '') {
                $note['notebook'] = 'inbox';
            } elseif ($this->notebookExists((string) $in['notebook'])) {
                $note['notebook'] = (string) $in['notebook'];
            }
        }
        if (isset($in['tags']) && is_array($in['tags'])) {
            $note['tags'] = self::cleanTags($in['tags']);
        }
        if (isset($in['pinned'])) {
            $note['pinned'] = (bool) $in['pinned'];
        }
        if (isset($in['clips']) && is_array($in['clips'])) {
            $note['clips'] = self::cleanClips($in['clips']);
        }
        if (isset($in['source']) && is_array($in['source'])) {
            $src = [];
            foreach (['url', 'author', 'site', 'published'] as $k) {
                $src[$k] = str_clip(trim((string) ($in['source'][$k] ?? '')), 500);
            }
            $note['source'] = $src;
        }
        if (isset($in['status']) && in_array($in['status'], ['', 'to-read', 'reading', 'done'], true)) {
            $note['status'] = $in['status'];
        }
        if (isset($in['items']) && is_array($in['items'])) {
            $note['items'] = self::cleanItems($in['items']);
        }
        return $note;
    }

    /** ToDo list items: text, notes (Markdown), status and priority. */
    public static function cleanItems(array $items): array
    {
        $out = [];
        foreach ($items as $it) {
            if (!is_array($it)) {
                continue;
            }
            $out[] = [
                'id' => valid_id($it['id'] ?? null) ? $it['id'] : new_id(8),
                'text' => str_clip(trim((string) ($it['text'] ?? '')), 500),
                'notes' => str_clip((string) ($it['notes'] ?? ''), 50000),
                'status' => in_array($it['status'] ?? '', ['open', 'in-progress', 'done'], true) ? $it['status'] : 'open',
                'priority' => in_array($it['priority'] ?? '', ['high', 'medium', 'low'], true) ? $it['priority'] : 'medium',
                'created' => is_int($it['created'] ?? null) ? $it['created'] : now_ms(),
            ];
            if (count($out) >= 500) {
                break;
            }
        }
        return $out;
    }

    /** @return array{open: int, total: int, high: int} */
    public static function todoSummary(array $items): array
    {
        $open = 0;
        $high = 0;
        foreach ($items as $it) {
            if (($it['status'] ?? '') !== 'done') {
                $open++;
                if (($it['priority'] ?? '') === 'high') {
                    $high++;
                }
            }
        }
        return ['open' => $open, 'total' => count($items), 'high' => $high];
    }

    public static function cleanTags(array $tags): array
    {
        $out = [];
        foreach ($tags as $t) {
            if (!is_string($t)) {
                continue;
            }
            $t = mb_strtolower(trim($t));
            $t = ltrim($t, '#');
            $t = preg_replace('/\s+/u', '-', $t) ?? $t;
            $t = preg_replace('/[^\p{L}\p{N}_\/-]+/u', '', $t) ?? $t;
            $t = str_clip($t, 40);
            if ($t !== '') {
                $out[$t] = $t;
            }
            if (count($out) >= 40) {
                break;
            }
        }
        return array_values($out);
    }

    public static function cleanClips(array $clips): array
    {
        $fields = [
            'link' => ['url', 'title', 'description', 'site', 'image', 'comment'],
            'quote' => ['text', 'source', 'url', 'page', 'comment'],
            'image' => ['file', 'caption', 'url'],
            'pdf' => ['file', 'name', 'thumb', 'comment'],
            'text' => ['text'],
        ];
        $ints = ['pdf' => ['pages', 'size']];
        $out = [];
        foreach ($clips as $c) {
            if (!is_array($c) || !isset($c['kind'], $fields[$c['kind']])) {
                continue;
            }
            $kind = $c['kind'];
            $clip = [
                'id' => valid_id($c['id'] ?? null) ? $c['id'] : new_id(8),
                'kind' => $kind,
                'createdAt' => is_int($c['createdAt'] ?? null) ? $c['createdAt'] : now_ms(),
            ];
            foreach ($fields[$kind] as $f) {
                $limit = in_array($f, ['text', 'description', 'comment'], true) ? 50000 : 2000;
                $clip[$f] = str_clip((string) ($c[$f] ?? ''), $limit);
            }
            foreach ($ints[$kind] ?? [] as $f) {
                $clip[$f] = (int) ($c[$f] ?? 0);
            }
            $out[] = $clip;
            if (count($out) >= 300) {
                break;
            }
        }
        return $out;
    }

    // ---------------------------------------------------------------- index

    public function indexEntry(array $n): array
    {
        $plain = md_plain($n['body']);
        $snippet = $plain;
        if ($n['type'] === 'todo') {
            $open = [];
            foreach ($n['items'] as $it) {
                if ($it['status'] !== 'done' && $it['text'] !== '') {
                    $open[] = $it['text'];
                }
            }
            $snippet = implode(' · ', array_slice($open, 0, 3));
        }
        if ($snippet === '' && !empty($n['clips'])) {
            foreach ($n['clips'] as $c) {
                $t = $c['text'] ?? $c['title'] ?? $c['caption'] ?? $c['name'] ?? '';
                if ($t !== '') {
                    $snippet = $t;
                    break;
                }
            }
        }
        $kinds = [];
        foreach ($n['clips'] as $c) {
            $kinds[$c['kind']] = ($kinds[$c['kind']] ?? 0) + 1;
        }
        return [
            'id' => $n['id'],
            'title' => $n['title'],
            'snippet' => str_clip($snippet, 180),
            'type' => $n['type'],
            'notebook' => $n['notebook'],
            'tags' => $n['tags'],
            'pinned' => (bool) $n['pinned'],
            'trashed' => (bool) $n['trashed'],
            'created' => $n['created'],
            'updated' => $n['updated'],
            'words' => count_words($plain),
            'links' => extract_links($n['body']),
            'clips' => $kinds,
            'status' => $n['status'] ?? '',
            'todo' => $n['type'] === 'todo' ? self::todoSummary($n['items']) : null,
            'sample' => !empty($n['sample']),
            'rev' => (int) ($n['rev'] ?? 0),
        ];
    }

    public function loadIndex(): array
    {
        if ($this->index !== null) {
            return $this->index;
        }
        $data = read_json($this->path('index.json'), null);
        if (!is_array($data) || !isset($data['notes']) || !is_array($data['notes'])) {
            return $this->index = $this->rebuildIndex();
        }
        return $this->index = $data['notes'];
    }

    public function saveIndex(array $notes): void
    {
        $this->index = $notes;
        write_json($this->path('index.json'), ['v' => 1, 'notes' => (object) $notes], false);
    }

    public function rebuildIndex(): array
    {
        $notes = [];
        foreach (glob($this->root . '/notes/*.json') ?: [] as $file) {
            $n = read_json($file, null);
            if (is_array($n) && isset($n['id'])) {
                $n = $this->withDefaults($n);
                $notes[$n['id']] = $this->indexEntry($n);
            }
        }
        $this->saveIndex($notes);
        return $notes;
    }

    /** Persist a note + keep the index in sync. Caller should hold the lock. */
    public function persist(array $note, bool $bumpRev = true): array
    {
        if ($bumpRev || !isset($note['rev'])) {
            $note['rev'] = (int) ($note['rev'] ?? 0) + 1;   // content revision, used for conflict detection
        }
        write_json($this->notePath($note['id']), $note);
        $index = $this->loadIndex();
        $entry = $this->indexEntry($note);
        $index[$note['id']] = $entry;
        $this->saveIndex($index);
        return $entry;
    }

    public function removeNote(string $id): void
    {
        @unlink($this->notePath($id));
        $dir = $this->versionsDir($id);
        if (is_dir($dir)) {
            foreach (glob($dir . '/*.json') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($dir);
        }
        $index = $this->loadIndex();
        unset($index[$id]);
        $this->saveIndex($index);
    }

    public function allNotes(bool $withTrashed = false): array
    {
        $out = [];
        foreach ($this->loadIndex() as $id => $entry) {
            if (!$withTrashed && !empty($entry['trashed'])) {
                continue;
            }
            $n = $this->readNote((string) $id);
            if ($n) {
                $out[] = $n;
            }
        }
        return $out;
    }

    // ---------------------------------------------------------------- versions

    public function listVersions(string $noteId): array
    {
        $dir = $this->versionsDir($noteId);
        $out = [];
        foreach (glob($dir . '/*.json') ?: [] as $f) {
            $v = read_json($f, null);
            if (!is_array($v)) {
                continue;
            }
            $out[] = [
                'id' => $v['id'], 'at' => $v['at'], 'label' => $v['label'] ?? '',
                'title' => $v['title'] ?? '', 'words' => $v['words'] ?? 0,
                'clips' => count($v['clips'] ?? []),
            ];
        }
        usort($out, fn($a, $b) => $b['at'] <=> $a['at']);
        return $out;
    }

    private function versionFile(string $noteId, string $versionId): ?string
    {
        if (!valid_id($versionId)) {
            return null;
        }
        $m = glob($this->versionsDir($noteId) . '/*_' . $versionId . '.json');
        return $m ? $m[0] : null;
    }

    public function getVersion(string $noteId, string $versionId): ?array
    {
        $f = $this->versionFile($noteId, $versionId);
        return $f ? read_json($f, null) : null;
    }

    public function deleteVersion(string $noteId, string $versionId): bool
    {
        $f = $this->versionFile($noteId, $versionId);
        return $f ? @unlink($f) : false;
    }

    public function latestVersionAt(string $noteId): int
    {
        $files = glob($this->versionsDir($noteId) . '/*.json') ?: [];
        if (!$files) {
            return 0;
        }
        rsort($files);
        return (int) strtok(basename($files[0]), '_');
    }

    public function snapshot(array $note, string $label = ''): array
    {
        $at = now_ms();
        $id = new_id(8);
        $v = [
            'id' => $id, 'at' => $at, 'label' => str_clip(trim($label), 120),
            'title' => $note['title'], 'body' => $note['body'], 'tags' => $note['tags'],
            'type' => $note['type'], 'clips' => $note['clips'], 'source' => $note['source'] ?? null,
            'items' => $note['items'] ?? [],
            'words' => count_words(md_plain($note['body'])),
        ];
        write_json($this->versionsDir($note['id']) . '/' . $at . '_' . $id . '.json', $v);
        $this->pruneVersions($note['id']);
        return $v;
    }

    private function pruneVersions(string $noteId): void
    {
        $files = glob($this->versionsDir($noteId) . '/*.json') ?: [];
        if (count($files) <= self::MAX_VERSIONS) {
            return;
        }
        sort($files);
        $excess = count($files) - self::MAX_VERSIONS;
        foreach ($files as $f) {
            if ($excess <= 0) {
                break;
            }
            $v = read_json($f, []);
            if (empty($v['label'])) {   // labelled checkpoints are kept
                @unlink($f);
                $excess--;
            }
        }
    }

    /** Snapshot the *previous* state when a new editing session begins. */
    public function maybeSnapshotBefore(array $before, array $after): void
    {
        $changed = $before['title'] !== $after['title'] || $before['body'] !== $after['body']
            || $before['clips'] != $after['clips'] || $before['tags'] != $after['tags'] || $before['items'] != $after['items'];
        if (!$changed) {
            return;
        }
        $hadContent = trim($before['body']) !== '' || !empty($before['clips']) || !empty($before['items']) || trim($before['title']) !== '';
        if (!$hadContent) {
            return;
        }
        $last = $this->latestVersionAt($before['id']);
        if ($last === 0 || (now_ms() - $last) >= self::VERSION_GAP_MS) {
            $this->snapshot($before);
        }
    }

    // ---------------------------------------------------------------- files

    public function fileMeta(string $id): ?array
    {
        return valid_id($id) ? read_json($this->path("files/$id.json"), null) : null;
    }

    public function filePath(array $meta): string
    {
        return $this->path('files/' . $meta['id'] . '.' . $meta['ext']);
    }

    public function fileText(string $id): string
    {
        $p = $this->path("files/$id.txt");
        return is_file($p) ? (string) file_get_contents($p) : '';
    }

    // ---------------------------------------------------------------- title uniqueness helper

    public function findByTitle(string $title): ?array
    {
        $needle = mb_strtolower(trim($title));
        $best = null;
        foreach ($this->loadIndex() as $e) {
            if (!empty($e['trashed'])) {
                continue;
            }
            if (mb_strtolower($e['title']) === $needle) {
                if ($best === null || $e['updated'] > $best['updated']) {
                    $best = $e;
                }
            }
        }
        return $best;
    }
}
