/**
 * Verifies the product upload pipeline without a browser.
 * Run from project root: node server/scripts/verify-upload-flow.js
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const projectRoot = path.resolve(__dirname, "../..");
process.chdir(projectRoot);

const config = require("../config/env");
const { initializeClient } = require("../database/sqlite/client");
const { applyMigrations } = require("../database/sqlite/migrate");
const { prepareStorageFoundation } = require("../services/storage-foundation.service");
const { createUploadFilename, buildPublicUploadUrl, normalizeManagedPath } = require("../services/uploadstorage.service");
const { createApp } = require("../app");
const { generateToken } = require("../utils/token");
const { connectDatabase } = require("../database");

const TEST_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQgAE/QJ+lfHxrAAAAABJRU5ErkJggg==",
  "base64"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function multipartBody(boundary, fields = [], fileField = null) {
  const chunks = [];

  fields.forEach(([name, value]) => {
    chunks.push(`--${boundary}`);
    chunks.push(`Content-Disposition: form-data; name="${name}"`);
    chunks.push("");
    chunks.push(String(value));
  });

  if (fileField) {
    chunks.push(`--${boundary}`);
    chunks.push(`Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"`);
    chunks.push(`Content-Type: ${fileField.mimeType}`);
    chunks.push("");
    chunks.push(fileField.buffer.toString("binary"));
  }

  chunks.push(`--${boundary}--`);
  chunks.push("");
  return Buffer.from(chunks.join("\r\n"), "binary");
}

function request(app, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const target = new URL(url, `http://127.0.0.1:${address.port}`);
      const req = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method,
          headers: options.headers || {}
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            server.close();
            const body = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = JSON.parse(body);
            } catch (_error) {
              json = null;
            }
            resolve({ status: res.statusCode, body, json });
          });
        }
      );

      req.on("error", (error) => {
        server.close();
        reject(error);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  });
}

async function main() {
  console.log("[verify-upload-flow] Initializing storage and database...");
  prepareStorageFoundation();
  const db = initializeClient();
  applyMigrations(db, config.sqlite.migrationsDir);

  const columns = db.prepare("PRAGMA table_info(products)").all().map((row) => row.name);
  assert(columns.includes("metadata_json"), "products.metadata_json migration is missing");

  const app = createApp();
  const adminToken = generateToken({
    id: "verify-upload",
    email: process.env.ADMIN_EMAIL || "admin@byosemarket.test",
    role: "admin"
  });

  const health = await request(app, "GET", "/api/uploads/health");
  assert(health.status === 200, `Upload health failed with status ${health.status}`);
  assert(health.json?.success === true, "Upload health response was not successful");

  const boundary = `----ByoseUpload${Date.now()}`;
  const uploadBody = multipartBody(boundary, [], {
    name: "file",
    filename: "verify.png",
    mimeType: "image/png",
    buffer: TEST_IMAGE
  });

  const upload = await request(app, "POST", "/api/uploads/products", {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(uploadBody.length)
    },
    body: uploadBody
  });

  assert(upload.status === 201, `Upload failed with status ${upload.status}: ${upload.body}`);
  assert(upload.json?.success === true, "Upload response was not successful");
  assert(Array.isArray(upload.json.files) && upload.json.files.length, "Upload response did not include files");

  const uploaded = upload.json.files[0];
  const storagePath = normalizeManagedPath(uploaded.storagePath || uploaded.path);
  assert(storagePath.startsWith("products/"), `Unexpected storage path: ${storagePath}`);

  const absolutePath = path.resolve(config.uploads.rootDir, storagePath);
  assert(fs.existsSync(absolutePath), `Uploaded file missing on disk: ${absolutePath}`);

  const publicPath = buildPublicUploadUrl("products", path.basename(storagePath));
  const staticFile = await request(app, "GET", publicPath);
  assert(staticFile.status === 200, `Static upload route failed with status ${staticFile.status}`);

  await connectDatabase();
  const createProduct = await request(app, "POST", "/api/admin/products", {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `Upload Verify ${Date.now()}`,
      price: 15000,
      stock: 5,
      category: "general",
      mainImage: uploaded.publicUrl || publicPath,
      mainImageStoragePath: storagePath,
      gallery: [uploaded.publicUrl || publicPath],
      galleryStoragePaths: [storagePath],
      visibility: "both",
      status: "active"
    })
  });

  assert(createProduct.status === 201, `Product create failed with status ${createProduct.status}: ${createProduct.body}`);
  assert(createProduct.json?.success === true, "Product create response was not successful");
  assert(createProduct.json?.product?.mainImage, "Created product is missing mainImage");

  console.log("[verify-upload-flow] PASS");
  console.log(`  storagePath: ${storagePath}`);
  console.log(`  publicPath: ${publicPath}`);
  console.log(`  productId: ${createProduct.json.product.catalogId || createProduct.json.product.id}`);
}

main().catch((error) => {
  console.error("[verify-upload-flow] FAIL");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
