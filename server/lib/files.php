<?php
declare(strict_types=1);

const ALLOWED_UPLOADS = [
    'application/pdf' => 'pdf',
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/gif' => 'gif',
    'image/webp' => 'webp',
    'image/avif' => 'avif',
];

function handle_upload(Store $store): never
{
    if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
        fail(400, 'No file received (is it larger than the server upload limit?)');
    }
    $f = $_FILES['file'];
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $msg = match ($f['error']) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'File exceeds the server upload limit (raise upload_max_filesize / post_max_size)',
            default => 'Upload failed (code ' . $f['error'] . ')',
        };
        fail(413, $msg);
    }
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = (string) $finfo->file($f['tmp_name']);
    if (!isset(ALLOWED_UPLOADS[$mime])) {
        fail(415, 'Only PDF and image files (PNG, JPEG, GIF, WebP, AVIF) can be attached');
    }
    $ext = ALLOWED_UPLOADS[$mime];
    $id = new_id(12);
    $dest = $store->path("files/$id.$ext");
    if (!move_uploaded_file($f['tmp_name'], $dest)) {
        if (!@rename($f['tmp_name'], $dest) && !@copy($f['tmp_name'], $dest)) {
            fail(500, 'Could not store the file');
        }
    }
    $name = safe_name(pathinfo((string) ($f['name'] ?? 'file'), PATHINFO_FILENAME), 'file') . '.' . $ext;
    $meta = [
        'id' => $id, 'ext' => $ext, 'mime' => $mime, 'name' => $name,
        'size' => (int) filesize($dest), 'created' => now_ms(),
    ];
    write_json($store->path("files/$id.json"), $meta);
    send_json($meta + ['url' => "api/files/$id"], 201);
}

function serve_file(Store $store, string $id): never
{
    $meta = $store->fileMeta($id);
    if (!$meta) {
        fail(404, 'File not found');
    }
    $path = $store->filePath($meta);
    if (!is_file($path)) {
        fail(404, 'File missing on disk');
    }
    $size = (int) filesize($path);
    $start = 0;
    $end = $size - 1;
    header('Content-Type: ' . $meta['mime']);
    header('X-Content-Type-Options: nosniff');
    // Images are fully sandboxed. PDFs can't be sandboxed or the browser's built-in viewer refuses to load them;
    // they are verified as real PDFs on upload and served with nosniff, so no script can run from them.
    if ($meta['mime'] === 'application/pdf') {
        header('Content-Security-Policy: default-src \'none\'; object-src \'self\'; plugin-types application/pdf; style-src \'unsafe-inline\'; img-src \'self\' data:');
    } else {
        header('Content-Security-Policy: sandbox; default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'');
    }
    header('Cache-Control: private, max-age=31536000, immutable');
    header('Accept-Ranges: bytes');
    $disp = isset($_GET['download']) ? 'attachment' : 'inline';
    header('Content-Disposition: ' . $disp . '; filename="' . str_replace('"', '', $meta['name']) . '"; filename*=UTF-8\'\'' . rawurlencode($meta['name']));

    if (!empty($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
        if ($m[1] !== '') { $start = (int) $m[1]; }
        if ($m[2] !== '') { $end = min($end, (int) $m[2]); }
        if ($m[1] === '' && $m[2] !== '') { $start = max(0, $size - (int) $m[2]); $end = $size - 1; }
        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            exit;
        }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    $fh = fopen($path, 'rb');
    fseek($fh, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($fh)) {
        $chunk = fread($fh, min(1 << 16, $left));
        if ($chunk === false) { break; }
        echo $chunk;
        $left -= strlen($chunk);
    }
    fclose($fh);
    exit;
}
