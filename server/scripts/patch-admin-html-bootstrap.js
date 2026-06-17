/**
 * Adds runtime-api-bootstrap.js before admin-security.js on admin HTML pages.
 * Run: node server/scripts/patch-admin-html-bootstrap.js
 */
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const adminRoot = path.join(projectRoot, "admin");
const bootstrapTarget = path.join(projectRoot, "config", "runtime-api-bootstrap.js");

function walkHtmlFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(fullPath, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function patchFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.includes("admin-security.js") || content.includes("runtime-api-bootstrap.js")) {
    return false;
  }

  const relativeDir = path.relative(path.dirname(filePath), path.dirname(bootstrapTarget));
  const bootstrapSrc = `${toPosix(relativeDir)}/runtime-api-bootstrap.js`.replace(/^\/?/, relativeDir ? "" : "./");
  const normalizedSrc = bootstrapSrc.startsWith(".") ? bootstrapSrc : `./${bootstrapSrc}`;
  const bootstrapTag = `<script src="${normalizedSrc.replace(/\\/g, "/")}"></script>`;

  const updated = content.replace(
    /(\s*)<script src="[^"]*admin-security\.js"><\/script>/,
    `$1${bootstrapTag}\n$1<script src="${content.match(/<script src="([^"]*admin-security\.js)"><\/script>/)?.[1] || "admin-login/js/admin-security.js"}"></script>`
  );

  if (updated === content) {
    return false;
  }

  fs.writeFileSync(filePath, updated, "utf8");
  return true;
}

function main() {
  const files = walkHtmlFiles(adminRoot);
  let patched = 0;

  for (const filePath of files) {
    if (patchFile(filePath)) {
      patched += 1;
      console.log(`patched ${path.relative(projectRoot, filePath)}`);
    }
  }

  console.log(`[patch-admin-html-bootstrap] patched ${patched} file(s)`);
}

main();
