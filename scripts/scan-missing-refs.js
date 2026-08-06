const fs = require("fs");
const path = require("path");

const root = process.cwd();
const skipDirs = new Set(["node_modules", "archive-unused", ".git", "uploads", "logs", ".cursor"]);
const missing = [];
const htmlFiles = [];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (/\.(html|htm)$/i.test(ent.name)) htmlFiles.push(full);
  }
}

walk(root);

const attrRe = /(?:src|href)=["']([^"'#?]+)/gi;
for (const file of htmlFiles) {
  const text = fs.readFileSync(file, "utf8");
  let match;
  while ((match = attrRe.exec(text))) {
    const ref = String(match[1] || "").trim();
    if (!ref || /^(https?:|data:|mailto:|tel:|\/\/)/i.test(ref)) continue;
    if (!/\.(css|js|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|json|html)$/i.test(ref)) continue;

    let resolved;
    if (ref.startsWith("/")) {
      resolved = path.join(root, ref.replace(/^\/+/, ""));
    } else {
      resolved = path.resolve(path.dirname(file), ref);
    }

    if (!fs.existsSync(resolved)) {
      missing.push({
        file: path.relative(root, file).replace(/\\/g, "/"),
        ref,
        resolved: path.relative(root, resolved).replace(/\\/g, "/")
      });
    }
  }
}

// Scan admin SPA relative imports for missing modules
const jsMissing = [];
const importRe = /from\s+["'](\.\.?\/[^"']+)["']/g;
function walkJs(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(full);
    else if (/\.js$/i.test(ent.name)) {
      const text = fs.readFileSync(full, "utf8");
      let match;
      while ((match = importRe.exec(text))) {
        let spec = match[1];
        if (!spec.endsWith(".js") && !spec.endsWith(".json") && !spec.endsWith(".css")) {
          const asJs = path.resolve(path.dirname(full), `${spec}.js`);
          const asIndex = path.resolve(path.dirname(full), spec, "index.js");
          if (!fs.existsSync(asJs) && !fs.existsSync(asIndex) && !fs.existsSync(path.resolve(path.dirname(full), spec))) {
            jsMissing.push({
              file: path.relative(root, full).replace(/\\/g, "/"),
              ref: spec
            });
          }
          continue;
        }
        const resolved = path.resolve(path.dirname(full), spec);
        if (!fs.existsSync(resolved)) {
          jsMissing.push({
            file: path.relative(root, full).replace(/\\/g, "/"),
            ref: spec,
            resolved: path.relative(root, resolved).replace(/\\/g, "/")
          });
        }
      }
    }
  }
}

walkJs(path.join(root, "admin", "app"));
walkJs(path.join(root, "services"));
walkJs(path.join(root, "shared"));
walkJs(path.join(root, "config"));

console.log(JSON.stringify({
  htmlFiles: htmlFiles.length,
  missingHtmlAssets: missing,
  missingJsImports: jsMissing
}, null, 2));
