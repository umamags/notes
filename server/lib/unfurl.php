<?php
declare(strict_types=1);

/**
 * Fetch basic page metadata (title / description / site / author) for a link card.
 * Plain HTML <meta> parsing — no AI. SSRF-guarded: public http(s) hosts only,
 * redirects are followed manually and re-validated at every hop.
 */

function host_is_public(string $host): bool
{
    $host = trim($host, '[]');
    if ($host === '' || strcasecmp($host, 'localhost') === 0) {
        return false;
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return (bool) filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }
    $ips = gethostbynamel($host) ?: [];
    if (!$ips) {
        return false;
    }
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return false;
        }
    }
    return true;
}

function absolute_url(string $base, string $rel): string
{
    if ($rel === '' || preg_match('#^https?://#i', $rel)) {
        return $rel;
    }
    $p = parse_url($base);
    if (!$p || empty($p['host'])) {
        return $rel;
    }
    $origin = ($p['scheme'] ?? 'https') . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    if (str_starts_with($rel, '//')) {
        return ($p['scheme'] ?? 'https') . ':' . $rel;
    }
    if (str_starts_with($rel, '/')) {
        return $origin . $rel;
    }
    $dir = isset($p['path']) ? preg_replace('#/[^/]*$#', '/', $p['path']) : '/';
    return $origin . $dir . $rel;
}

function fetch_html(string $url): ?array
{
    for ($hop = 0; $hop < 5; $hop++) {
        $p = parse_url($url);
        if (!$p || !in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true) || empty($p['host'])) {
            return null;
        }
        if (!host_is_public($p['host'])) {
            return null;
        }
        $body = '';
        $headers = [];
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 7,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; FolioNotes/1.0; +link-preview)',
            CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language: en'],
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_ENCODING => '',
            CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$headers) {
                $parts = explode(':', $h, 2);
                if (count($parts) === 2) {
                    $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return strlen($h);
            },
            CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$body) {
                $body .= $chunk;
                return strlen($body) > 600000 ? 0 : strlen($chunk);   // abort once we have enough
            },
        ]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($code >= 300 && $code < 400 && !empty($headers['location'])) {
            $url = absolute_url($url, $headers['location']);
            continue;
        }
        if ($code === 0 && $body === '') {
            return null;
        }
        return ['url' => $url, 'html' => $body, 'headers' => $headers, 'code' => $code];
    }
    return null;
}

function unfurl_url(Store $store, string $url): array
{
    $url = trim($url);
    if (!preg_match('#^https?://#i', $url)) {
        $url = 'https://' . $url;
    }
    $cacheFile = $store->path('cache/unfurl-' . sha1($url) . '.json');
    $cached = read_json($cacheFile, null);
    if (is_array($cached) && ($cached['at'] ?? 0) > time() - 86400 * 14) {
        return $cached['data'];
    }

    $host = parse_url($url, PHP_URL_HOST) ?: $url;
    $result = [
        'url' => $url, 'title' => '', 'description' => '', 'site' => preg_replace('/^www\./i', '', (string) $host),
        'author' => '', 'image' => '', 'published' => '', 'ok' => false,
    ];

    $res = fetch_html($url);
    if ($res && $res['html'] !== '') {
        $html = $res['html'];
        $ctype = $res['headers']['content-type'] ?? '';
        if ($ctype === '' || stripos($ctype, 'html') !== false || stripos($ctype, 'xml') !== false) {
            if (!mb_check_encoding($html, 'UTF-8')) {
                $html = mb_convert_encoding($html, 'UTF-8', 'ISO-8859-1');
            }
            $meta = [];
            $prev = libxml_use_internal_errors(true);
            $doc = new DOMDocument();
            $doc->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_NONET);
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
            foreach ($doc->getElementsByTagName('meta') as $m) {
                $k = strtolower($m->getAttribute('property') ?: $m->getAttribute('name'));
                $v = trim($m->getAttribute('content'));
                if ($k !== '' && $v !== '' && !isset($meta[$k])) {
                    $meta[$k] = $v;
                }
            }
            $title = $meta['og:title'] ?? $meta['twitter:title'] ?? '';
            if ($title === '') {
                $t = $doc->getElementsByTagName('title')->item(0);
                $title = $t ? trim($t->textContent) : '';
            }
            $result['title'] = str_clip(html_entity_decode(preg_replace('/\s+/u', ' ', $title) ?? $title), 300);
            $result['description'] = str_clip(preg_replace('/\s+/u', ' ', $meta['og:description'] ?? $meta['description'] ?? $meta['twitter:description'] ?? '') ?? '', 600);
            $result['site'] = str_clip($meta['og:site_name'] ?? $result['site'], 120);
            $result['author'] = str_clip($meta['author'] ?? $meta['article:author'] ?? '', 160);
            $result['published'] = str_clip($meta['article:published_time'] ?? $meta['date'] ?? '', 40);
            $img = $meta['og:image'] ?? $meta['twitter:image'] ?? '';
            $result['image'] = $img !== '' ? absolute_url($res['url'], $img) : '';
            $result['url'] = $res['url'];
            $result['ok'] = $result['title'] !== '';
        }
    }
    write_json($cacheFile, ['at' => time(), 'data' => $result], false);
    return $result;
}
