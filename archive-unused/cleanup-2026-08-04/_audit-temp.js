const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const skipDirs = new Set(['node_modules', '.git', 'server', 'archive-unused']);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1. Missing HTML references
const htmlFiles = walk(ROOT).filter((f) => f.endsWith('.html'));
const missing = [];
const re = /(?:src|href)=["']([^"'#?]+)["']/g;
for (const html of htmlFiles) {
  const content = fs.readFileSync(html, 'utf8');
  const dir = path.dirname(html);
  let m;
  while ((m = re.exec(content))) {
    let ref = m[1].trim();
    if (/^(https?:|data:|mailto:|tel:|javascript:)/i.test(ref) || ref.startsWith('//')) continue;
    ref = ref.replace(/^\.\//, '');
    const resolved = path.normalize(path.join(dir, ref));
    if (!fs.existsSync(resolved)) {
      missing.push({ html: path.relative(ROOT, html), ref, resolved: path.relative(ROOT, resolved) });
    }
  }
}

// 2. Syntax check frontend JS (exclude server)
const jsDirs = ['js', 'services', 'shared', 'components', 'config', 'details', 'orders', 'account', 'admin'];
const rootJs = walk(ROOT).filter((f) => {
  if (!f.endsWith('.js')) return false;
  const rel = path.relative(ROOT, f);
  if (rel.startsWith('server' + path.sep) || rel.startsWith('archive-unused')) return false;
  if (rel.includes(path.sep)) {
    const top = rel.split(path.sep)[0];
    if (['js', 'services', 'shared', 'components', 'config', 'details', 'orders', 'account', 'admin'].includes(top)) return true;
    return false;
  }
  return true; // root level js
});

const syntaxErrors = [];
for (const f of rootJs) {
  try {
    const code = fs.readFileSync(f, 'utf8');
    new Function(code); // basic parse for non-module scripts
  } catch (e) {
    // modules may fail on import/export - try acorn if available else note
    if (/Unexpected token 'export'|Cannot use import statement/.test(e.message)) {
      // check with node --check via spawn later
    } else {
      syntaxErrors.push({ file: path.relative(ROOT, f), error: e.message });
    }
  }
}

// 3. Find duplicate top-level function names across frontend js
const fnRe = /(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const fnMap = new Map();
for (const f of rootJs) {
  const rel = path.relative(ROOT, f);
  const code = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = fnRe.exec(code))) {
    const name = m[1];
    if (!fnMap.has(name)) fnMap.set(name, []);
    fnMap.get(name).push(rel);
  }
}
const dupFns = [...fnMap.entries()].filter(([, files]) => files.length > 1 && new Set(files).size > 1)
  .map(([name, files]) => ({ name, files: [...new Set(files)] }))
  .sort((a, b) => b.files.length - a.files.length);

// 4. Unused files in key dirs (not referenced anywhere in html/js/css)
const keyDirs = ['js', 'services', 'shared'];
const keyFiles = walk(ROOT).filter((f) => {
  const rel = path.relative(ROOT, f);
  return keyDirs.some((d) => rel.startsWith(d + path.sep) || rel === d);
}).filter((f) => f.endsWith('.js'));

const allText = walk(ROOT)
  .filter((f) => /\.(html|js|css)$/.test(f) && !f.includes('node_modules'))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

const unused = [];
for (const f of keyFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const base = path.basename(f);
  const patterns = [rel, base, rel.replace(/\.js$/, '')];
  const referenced = patterns.some((p) => allText.includes(p));
  if (!referenced) unused.push(rel);
}

console.log('=== MISSING HTML REFS ===');
console.log(JSON.stringify(missing, null, 2));
console.log('\n=== SYNTAX ERRORS (basic) ===');
console.log(JSON.stringify(syntaxErrors, null, 2));
console.log('\n=== DUPLICATE FUNCTIONS (sample top 30) ===');
console.log(JSON.stringify(dupFns.slice(0, 30), null, 2));
console.log('\n=== POSSIBLY UNUSED key dir files ===');
console.log(JSON.stringify(unused.sort(), null, 2));
