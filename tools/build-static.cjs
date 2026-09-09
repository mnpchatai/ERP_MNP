// Reproducible vendoring of the locked SDK for branch-based GitHub Pages.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'vendor'),{recursive:true});
fs.copyFileSync(path.join(root,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),path.join(root,'vendor/supabase.js'));
fs.copyFileSync(path.join(root,'node_modules/@supabase/supabase-js/LICENSE'),path.join(root,'vendor/SUPABASE-LICENSE'));
