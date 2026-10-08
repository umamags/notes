<?php
declare(strict_types=1);

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function new_id(int $len = 10): string
{
    $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    $bytes = random_bytes($len);
    $out = '';
    for ($i = 0; $i < $len; $i++) {
        $out .= $alphabet[ord($bytes[$i]) % 36];
    }
    return $out;
}

function valid_id(?string $id): bool
{
    return is_string($id) && preg_match('/^[a-z0-9]{6,32}$/', $id) === 1;
}

function send_json(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR
    );
    exit;
}

function fail(int $status, string $message, array $extra = []): never
{
    send_json(['error' => $message] + $extra, $status);
}

function body_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail(400, 'Invalid JSON body');
    }
    return $data;
}

function atomic_write(string $path, string $data): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException("Cannot create directory $dir");
    }
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, $data, LOCK_EX) === false) {
        throw new RuntimeException("Cannot write $path");
    }
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException("Cannot move file into place: $path");
    }
}

function read_json(string $path, mixed $default = null): mixed
{
    if (!is_file($path)) {
        return $default;
    }
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') {
        return $default;
    }
    $data = json_decode($raw, true);
    return $data === null ? $default : $data;
}

function write_json(string $path, mixed $data, bool $pretty = true): void
{
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;
    if ($pretty) {
        $flags |= JSON_PRETTY_PRINT;
    }
    atomic_write($path, json_encode($data, $flags));
}

function str_clip(string $s, int $max): string
{
    return mb_strlen($s) > $max ? mb_substr($s, 0, $max) : $s;
}

/** Filesystem-safe name for exports. */
function safe_name(string $name, string $fallback = 'Untitled'): string
{
    $name = preg_replace('/[\\\\\/:*?"<>|\x00-\x1f]+/u', ' ', $name) ?? '';
    $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '', " .\t");
    if ($name === '') {
        $name = $fallback;
    }
    return str_clip($name, 80);
}

/** Remove fenced code blocks and inline code so we don't parse links inside them. */
function strip_code(string $md): string
{
    $md = preg_replace('/^(```|~~~)[^\n]*\n.*?^\1[ \t]*$/ms', '', $md) ?? $md;
    $md = preg_replace('/`[^`\n]*`/u', '', $md) ?? $md;
    return $md;
}

/** Titles referenced via [[wiki links]] */
function extract_links(string $md): array
{
    $clean = strip_code($md);
    $out = [];
    if (preg_match_all('/\[\[([^\[\]\|#\n]+?)(?:#[^\]\|\n]*)?(?:\|[^\]\n]*)?\]\]/u', $clean, $m)) {
        foreach ($m[1] as $title) {
            $t = trim($title);
            if ($t !== '') {
                $out[mb_strtolower($t)] = $t;
            }
        }
    }
    return array_values($out);
}

function md_plain(string $md): string
{
    $s = preg_replace('/^(```|~~~)[^\n]*\n(.*?)^\1[ \t]*$/ms', '$2', $md) ?? $md;
    $s = preg_replace('/!\[[^\]]*\]\([^)]*\)/u', '', $s) ?? $s;
    $s = preg_replace('/\[\[([^\]\|]+)\|([^\]]+)\]\]/u', '$2', $s) ?? $s;
    $s = preg_replace('/\[\[([^\]#]+)(#[^\]]*)?\]\]/u', '$1', $s) ?? $s;
    $s = preg_replace('/\[([^\]]+)\]\([^)]*\)/u', '$1', $s) ?? $s;
    $s = preg_replace('/<[^>]+>/u', '', $s) ?? $s;
    $s = preg_replace('/^\s{0,3}(#{1,6}|>+|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/m', '', $s) ?? $s;
    $s = preg_replace('/[*_~`]+/u', '', $s) ?? $s;
    $s = preg_replace('/^\s*([-*_]\s*){3,}$/m', '', $s) ?? $s;
    $s = preg_replace('/\|/u', ' ', $s) ?? $s;
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
    return trim($s);
}

function count_words(string $plain): int
{
    return (int) preg_match_all('/[\p{L}\p{N}][\p{L}\p{N}\'’_-]*/u', $plain);
}

function format_iso(int $ms): string
{
    return gmdate('Y-m-d\TH:i:s\Z', intdiv($ms, 1000));
}
