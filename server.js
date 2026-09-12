const http = require("http");
const fs = require("fs");
const path = require("path");
const env = {...process.env};
if (fs.existsSync(path.join(__dirname,'.env.local'))) {
  for (const line of fs.readFileSync(path.join(__dirname,'.env.local'),'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !env[match[1]]) env[match[1]] = match[2].trim();
  }
}

const port = Number(process.env.PORT) || 8787;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };
const publicFiles = new Set(['index.html','app.js','styles.css','theme.css','theme.js','rb.html','rb.js','rb.css','rb-calc.mjs','connect.html','connect.js','public-config.js','supabase-client.mjs','rb-cloud.mjs','rb-catalog.mjs','catalog.css',
  'mrp.html','mrp.js','mrp.css','mrp-data.mjs','mrp-csv.mjs','mrp-import.html','mrp-import.js',
  'bom-import.html','bom-import.js','production.html','production.js','production.css',
  'structure.html','structure.js','structure.css','auth-gate.mjs']);

http.createServer((request, response) => {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Cache-Control','no-store');
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  if (request.url === '/api/public-config') {
    const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url || '') || !key?.startsWith('sb_publishable_')) {
      response.writeHead(503).end('Missing public Supabase configuration'); return;
    }
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({url,key})); return;
  }
  if (request.url === '/vendor/supabase.js') {
    // Prefer the installed SDK; fall back to the vendored copy the Pages build ships,
    // so the app still runs in a checkout that has not had npm install.
    fs.readFile(path.join(__dirname,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),(error,content)=>{
      if(!error){response.setHeader('Content-Type','text/javascript');response.end(content);return;}
      fs.readFile(path.join(__dirname,'vendor/supabase.js'),(fallbackError,vendored)=>{
        if(fallbackError){response.writeHead(503).end('Run npm install or npm run build first');return;}
        response.setHeader('Content-Type','text/javascript');response.end(vendored);
      });
    }); return;
  }
  const relative = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\/+/, "");
  const file = path.resolve(__dirname, relative);
  if (!publicFiles.has(relative)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", types[path.extname(file)]);
    response.end(content);
  });
}).listen(port, '127.0.0.1', () => console.log(`MNP ERP Simulation: http://localhost:${port}/rb.html`));
