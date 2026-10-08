<?php
declare(strict_types=1);

/**
 * Universal search over titles, bodies, tags, collected sources and extracted PDF text.
 * Plain string matching only (no AI, no embeddings) — files are scanned on demand,
 * which is comfortably fast for thousands of notes.
 */

function parse_query(string $q): array
{
    $p = [
        'terms' => [], 'phrases' => [], 'neg' => [], 'tags' => [], 'in' => [], 'type' => null,
        'pinned' => false, 'trashed' => false, 'has' => [], 'status' => null, 'before' => null, 'after' => null,
    ];
    if (!preg_match_all('/(-?)(?:([a-z]+):)?(?:"([^"]+)"|(\S+))/iu', $q, $m, PREG_SET_ORDER)) {
        return $p;
    }
    foreach ($m as $tok) {
        $neg = $tok[1] === '-';
        $key = mb_strtolower($tok[2] ?? '');
        $val = ($tok[3] ?? '') !== '' ? $tok[3] : ($tok[4] ?? '');
        $quoted = ($tok[3] ?? '') !== '';
        $lval = mb_strtolower($val);
        if ($key !== '' && in_array($key, ['tag', 'in', 'type', 'is', 'has', 'status', 'before', 'after'], true)) {
            switch ($key) {
                case 'tag': $p['tags'][] = ltrim($lval, '#'); break;
                case 'in': $p['in'][] = $lval; break;
                case 'type': $p['type'] = $lval; break;
                case 'is':
                    if ($lval === 'pinned') { $p['pinned'] = true; }
                    if ($lval === 'trashed' || $lval === 'trash') { $p['trashed'] = true; }
                    break;
                case 'has': $p['has'][] = $lval; break;
                case 'status': $p['status'] = $lval; break;
                case 'before': $p['before'] = strtotime($lval . ' 00:00:00 UTC') ?: null; break;
                case 'after': $p['after'] = strtotime($lval . ' 23:59:59 UTC') ?: null; break;
            }
            continue;
        }
        $text = $key !== '' ? mb_strtolower($key . ':' . $val) : $lval;   // unknown "foo:" prefix stays literal
        if ($text === '') {
            continue;
        }
        if ($neg) {
            $p['neg'][] = $text;
        } elseif ($quoted) {
            $p['phrases'][] = $text;
        } else {
            $p['terms'][] = $text;
        }
    }
    return $p;
}

function notebook_descendants(array $notebooks, string $id): array
{
    $ids = [$id];
    $changed = true;
    while ($changed) {
        $changed = false;
        foreach ($notebooks as $nb) {
            if ($nb['parent'] !== null && in_array($nb['parent'], $ids, true) && !in_array($nb['id'], $ids, true)) {
                $ids[] = $nb['id'];
                $changed = true;
            }
        }
    }
    return $ids;
}

function clip_text(array $clips, Store $store, string &$pdfText): string
{
    $parts = [];
    foreach ($clips as $c) {
        foreach (['text', 'title', 'description', 'caption', 'comment', 'source', 'url', 'name', 'site'] as $f) {
            if (!empty($c[$f])) {
                $parts[] = $c[$f];
            }
        }
        if (($c['kind'] ?? '') === 'pdf' && !empty($c['file'])) {
            $pdfText .= "\n" . $store->fileText((string) $c['file']);
        }
    }
    return implode("\n", $parts);
}

function make_snippet(string $text, array $needles, int $width = 190): array
{
    $pos = null;
    foreach ($needles as $n) {
        $i = mb_stripos($text, $n);
        if ($i !== false && ($pos === null || $i < $pos)) {
            $pos = $i;
        }
    }
    if ($pos === null) {
        return [str_clip(md_plain($text), $width), []];
    }
    $start = max(0, $pos - 70);
    $window = mb_substr($text, $start, $width);
    $plain = md_plain($window);
    if ($start > 0) { $plain = '…' . $plain; }
    if (mb_strlen($text) > $start + $width) { $plain .= '…'; }
    $ranges = [];
    foreach ($needles as $n) {
        $offset = 0;
        $guard = 0;
        while (($i = mb_stripos($plain, $n, $offset)) !== false && $guard++ < 8) {
            $ranges[] = [$i, mb_strlen($n)];
            $offset = $i + max(1, mb_strlen($n));
        }
    }
    usort($ranges, fn($a, $b) => $a[0] <=> $b[0]);
    return [$plain, $ranges];
}

function run_search(Store $store, string $q, int $limit = 60): array
{
    $p = parse_query($q);
    $index = $store->loadIndex();
    $notebooks = $store->notebooks();

    $nbFilter = null;
    if ($p['in']) {
        $nbFilter = [];
        foreach ($p['in'] as $name) {
            foreach ($notebooks as $nb) {
                if (mb_strtolower($nb['name']) === $name || $nb['id'] === $name) {
                    $nbFilter = array_merge($nbFilter, notebook_descendants($notebooks, $nb['id']));
                }
            }
        }
        if (!$nbFilter) {
            return ['results' => [], 'total' => 0, 'terms' => []];
        }
    }

    $needles = array_merge($p['phrases'], $p['terms']);
    $hasText = $needles !== [] || $p['neg'] !== [];
    $results = [];
    $nowS = time();

    foreach ($index as $id => $e) {
        if (empty($e['trashed']) === $p['trashed']) {
            continue;
        }
        if ($p['pinned'] && empty($e['pinned'])) { continue; }
        if ($p['type'] && $e['type'] !== $p['type']) { continue; }
        if ($p['status'] && ($e['status'] ?? '') !== $p['status']) { continue; }
        if ($nbFilter !== null && !in_array($e['notebook'], $nbFilter, true)) { continue; }
        if ($p['before'] && intdiv($e['updated'], 1000) >= $p['before']) { continue; }
        if ($p['after'] && intdiv($e['updated'], 1000) <= $p['after']) { continue; }
        foreach ($p['tags'] as $t) {
            $ok = false;
            foreach ($e['tags'] as $et) {
                if ($et === $t || str_starts_with($et, $t . '/')) { $ok = true; break; }
            }
            if (!$ok) { continue 2; }
        }
        foreach ($p['has'] as $h) {
            $kinds = (array) ($e['clips'] ?? []);
            $match = match ($h) {
                'pdf', 'image', 'link', 'quote' => !empty($kinds[$h]),
                'image', 'screenshot' => !empty($kinds['image']),
                'source', 'sources', 'clips' => !empty($kinds),
                'links' => !empty($e['links']),
                default => true,
            };
            if (!$match) { continue 2; }
        }

        $score = 0.0;
        $snippet = $e['snippet'];
        $ranges = [];
        $where = 'meta';

        if ($hasText) {
            $note = $store->readNote((string) $id);
            if (!$note) { continue; }
            $title = mb_strtolower($note['title']);
            $tags = mb_strtolower(implode(' ', $note['tags']));
            $body = mb_strtolower($note['body']);
            $pdfText = '';
            $clipsRaw = clip_text($note['clips'], $store, $pdfText);
            $clips = mb_strtolower($clipsRaw);
            $pdf = mb_strtolower($pdfText);
            $src = mb_strtolower(implode(' ', (array) ($note['source'] ?? [])));
            $all = $title . "\n" . $tags . "\n" . $body . "\n" . $clips . "\n" . $pdf . "\n" . $src;

            foreach ($p['neg'] as $n) {
                if (mb_strpos($all, $n) !== false) { continue 2; }
            }
            foreach ($needles as $n) {
                if (mb_strpos($all, $n) === false) { continue 2; }
            }
            foreach ($needles as $n) {
                if (mb_strpos($title, $n) !== false) {
                    $score += 20;
                    if ($title === $n) { $score += 20; }
                    elseif (str_starts_with($title, $n)) { $score += 8; }
                }
                foreach ($note['tags'] as $tg) {
                    if ($tg === $n) { $score += 8; }
                }
                $score += min(6, mb_substr_count($body, $n)) * 1.5;
                $score += min(4, mb_substr_count($clips, $n)) * 1.0;
                $score += min(3, mb_substr_count($pdf, $n)) * 0.4;
            }

            // Pick the most informative place for the snippet.
            if (array_filter($needles, fn($n) => mb_strpos($body, $n) !== false)) {
                [$snippet, $ranges] = make_snippet($note['body'], $needles);
                $where = 'body';
            } elseif (array_filter($needles, fn($n) => mb_strpos($clips, $n) !== false)) {
                [$snippet, $ranges] = make_snippet($clipsRaw, $needles);
                $where = 'sources';
            } elseif (array_filter($needles, fn($n) => mb_strpos($pdf, $n) !== false)) {
                [$snippet, $ranges] = make_snippet($pdfText, $needles);
                $where = 'pdf';
            } elseif (array_filter($needles, fn($n) => mb_strpos($title, $n) !== false)) {
                $where = 'title';
            } else {
                $where = 'tags';
            }
        }

        $ageDays = max(0, ($nowS - intdiv($e['updated'], 1000)) / 86400);
        $score += 3 / (1 + $ageDays / 14);
        if (!empty($e['pinned'])) { $score += 1; }

        $results[] = [
            'id' => $e['id'], 'score' => round($score, 3), 'snippet' => $snippet,
            'ranges' => $ranges, 'where' => $where,
        ];
    }

    usort($results, fn($a, $b) => $b['score'] <=> $a['score']);
    $total = count($results);
    return [
        'results' => array_slice($results, 0, $limit),
        'total' => $total,
        'terms' => array_values(array_unique($needles)),
    ];
}

/** Context line around the first wiki-link to $title in $body. */
function link_context(string $body, string $title): string
{
    $lines = preg_split('/\R/u', $body) ?: [];
    $needle = mb_strtolower('[[' . $title);
    foreach ($lines as $line) {
        if (mb_strpos(mb_strtolower($line), $needle) !== false) {
            return str_clip(md_plain($line), 220);
        }
    }
    return '';
}

function note_links(Store $store, array $note, bool $withMentions = false): array
{
    $title = trim($note['title']);
    $lower = mb_strtolower($title);
    $back = [];
    $mentions = [];
    if ($title !== '') {
        foreach ($store->loadIndex() as $id => $e) {
            if ($id === $note['id'] || !empty($e['trashed'])) { continue; }
            $links = array_map('mb_strtolower', (array) $e['links']);
            $linked = in_array($lower, $links, true);
            if (!$linked && (!$withMentions || mb_strlen($title) < 3)) { continue; }
            $other = $store->readNote((string) $id);
            if (!$other) { continue; }
            if ($linked) {
                $back[] = ['id' => $id, 'title' => $other['title'], 'excerpt' => link_context($other['body'], $title)];
                continue;
            }
            $clean = strip_code($other['body']);
            if (preg_match('/(?<![\p{L}\p{N}])' . preg_quote($title, '/') . '(?![\p{L}\p{N}])/iu', $clean, $mm, PREG_OFFSET_CAPTURE)) {
                $pos = mb_strlen(substr($clean, 0, $mm[0][1]));
                [$ctx] = make_snippet(mb_substr($clean, max(0, $pos - 70)), [$title], 160);
                $mentions[] = ['id' => $id, 'title' => $other['title'], 'excerpt' => $ctx];
                if (count($mentions) >= 20) { $withMentions = false; }
            }
        }
    }
    $outgoing = [];
    foreach (extract_links($note['body']) as $t) {
        $hit = $store->findByTitle($t);
        $outgoing[] = ['title' => $t, 'id' => $hit['id'] ?? null];
    }
    return ['backlinks' => $back, 'mentions' => $mentions, 'outgoing' => $outgoing];
}
