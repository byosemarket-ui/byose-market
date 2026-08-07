const http = require("http");
const path = require("path");
const fs = require("fs");
const { createApp } = require("../server/app");
const { connectDatabase, closeDatabase } = require("../server/database");

async function get(port, routePath) {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: "127.0.0.1",
          port,
          path: routePath,
          headers: { Accept: "application/json" }
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode || 0, body: body.slice(0, 120) });
          });
        }
      )
      .on("error", reject);
  });
}

(async () => {
  const adminData = fs.readFileSync(
    path.resolve("admin/app/services/admin-data.service.js"),
    "utf8"
  );
  const importMatch = adminData.match(/from\s+["']([^"']*hero-slides[^"']*)["']/);
  if (!importMatch) {
    throw new Error("hero-slides import missing from admin-data.service.js");
  }
  const resolved = path.resolve("admin/app/services", importMatch[1]);
  if (!fs.existsSync(resolved)) {
    throw new Error(`hero-slides import resolves outside repo: ${resolved}`);
  }
  console.log("admin hero import OK:", importMatch[1]);

  await connectDatabase();
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  const paths = [
    "/healthz",
    "/api/products?limit=2",
    "/api/hero-slides",
    "/api/uploads/health",
    "/login.html",
    "/admin/dashboard.html",
    "/orders/shipping.html",
    "/categories.html"
  ];

  for (const routePath of paths) {
    const result = await get(port, routePath);
    console.log(result.status, routePath, result.body.replace(/\s+/g, " ").slice(0, 90));
  }

  await new Promise((resolve) => server.close(resolve));
  await closeDatabase().catch(() => {});
})().catch(async (error) => {
  console.error(error);
  await closeDatabase().catch(() => {});
  process.exit(1);
});
