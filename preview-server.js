const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || '.';
const PORT = +process.argv[3] || 8123;
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png',
  '.svg':'image/svg+xml', '.json':'application/json'
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('serving ' + ROOT + ' on ' + PORT));