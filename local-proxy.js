/**
 * local-proxy.js — zero-dependency local dev server for Paklance frontend.
 * Serves  public/  as static files on http://localhost:4000
 * Proxies /api/*   to the deployed production NestJS backend on Vercel.
 * Usage: node local-proxy.js
 */
'use strict';
var http  = require('http');
var https = require('https');
var fs    = require('fs');
var path  = require('path');
var url   = require('url');

var PORT        = 4000;
var PUBLIC_DIR  = path.join(__dirname, 'public');
var API_TARGET  = process.env.API_TARGET || 'paklance-backend-updated.vercel.app';
var API_PORT    = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : (API_TARGET.includes('localhost') || API_TARGET.includes('127.0.0.1') ? 3000 : 443);

var MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.webp':'image/webp', '.mp4':'video/mp4', '.webm':'video/webm'
};
function getMime(p){ return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

function proxyApi(req, res) {
  var client = API_PORT === 443 ? https : http;
  var opts = {
    hostname: API_TARGET, port: API_PORT, path: req.url, method: req.method,
    headers: Object.assign({}, req.headers, { host: API_TARGET })
  };
  delete opts.headers['origin']; delete opts.headers['referer'];
  var pr = client.request(opts, function(ps){
    res.writeHead(ps.statusCode, Object.assign({}, ps.headers, {
      'access-control-allow-origin':'*',
      'access-control-allow-methods':'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      'access-control-allow-headers':'Content-Type, Authorization'
    }));
    ps.pipe(res, {end:true});
  });
  pr.on('error', function(e){ res.writeHead(502); res.end(JSON.stringify({error:e.message})); });
  req.pipe(pr, {end:true});
}

function serveStatic(req, res) {
  var pathname = decodeURIComponent(url.parse(req.url).pathname);
  var fp = (!path.extname(pathname) || pathname === '/')
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(PUBLIC_DIR, pathname);
  if (!fp.startsWith(PUBLIC_DIR)){ res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(fp, function(err, data){
    if (err){ var fb=path.join(PUBLIC_DIR,'index.html'); fs.readFile(fb,function(e2,d2){ if(e2){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(d2);}); return; }
    res.writeHead(200, {'Content-Type': getMime(fp)}); res.end(data);
  });
}

var server = http.createServer(function(req, res){
  if (req.method==='OPTIONS'){ res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS','access-control-allow-headers':'Content-Type,Authorization'}); res.end(); return; }
  if (req.url.startsWith('/api/') || req.url==='/api'){ console.log('[proxy]',req.method,req.url); proxyApi(req,res); }
  else { console.log('[file ]',req.method,req.url); serveStatic(req,res); }
});

server.listen(PORT, function(){
  console.log('');
  console.log('  PAKLANCE LOCAL DEV SERVER');
  console.log('  Frontend : http://localhost:' + PORT);
  console.log('  API proxy: /api/* -> https://' + API_TARGET);
  console.log('');
});
