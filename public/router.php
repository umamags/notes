<?php
// Router for PHP's built-in server:  php -S 127.0.0.1:8080 -t public public/router.php
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (str_starts_with($path, '/api/')) {
    require __DIR__ . '/api/index.php';
    return true;
}
$file = realpath(__DIR__ . $path);
if ($file !== false && is_file($file) && str_starts_with($file, realpath(__DIR__)) && !str_ends_with($file, '.php')) {
    return false;   // let the built-in server serve static assets
}
readfile(__DIR__ . '/index.html');
return true;
