const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = 8765;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
    let requestPath = decodeURIComponent(req.url.split('?')[0]);
    if (requestPath === '/' || requestPath === '') requestPath = '/index.html';

    const target = path.resolve(root, requestPath.slice(1));
    if (!target.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(target, (error, data) => {
        if (error) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        res.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(port, '127.0.0.1', () => {
    console.log(`RODEMOS listo en http://127.0.0.1:${port}/index.html`);
});
