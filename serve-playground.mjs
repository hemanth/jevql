import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, 'docs');
const initialPort = parseInt(process.env.PORT || '3456', 10);

const mimeTypes = {
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(docsDir, urlPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

function listen(port) {
  server.listen(port, () => {
    console.log(`\x1b[32mJevQL Playground running at http://localhost:${port}\x1b[0m`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`\x1b[33mPort ${port} is in use, trying http://localhost:${port + 1}...\x1b[0m`);
      server.removeAllListeners('error');
      listen(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

listen(initialPort);
