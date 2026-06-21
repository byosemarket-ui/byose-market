/**
 * Verifies critical API routes respond (not 404) on a running server.
 * Run: node server/scripts/verify-api-routes.js [baseUrl]
 */
const http = require("http");
const https = require("https");

const baseUrl = String(process.argv[2] || "http://127.0.0.1:5000").replace(/\/+$/, "");

const ROUTES = [
  { method: "GET", path: "/contact.css", expect: [200] },
  { method: "GET", path: "/contact-desktop.css", expect: [200] },
  { method: "GET", path: "/contact.html", expect: [200] },
  { method: "GET", path: "/auth-modern.css", expect: [200] },
  { method: "GET", path: "/login-desktop.css", expect: [200] },
  { method: "GET", path: "/auth-mobile.css", expect: [200] },
  { method: "GET", path: "/signup-desktop.css", expect: [200] },
  { method: "GET", path: "/signup-mobile.css", expect: [200] },
  { method: "GET", path: "/login.html", expect: [200] },
  { method: "GET", path: "/signup.html", expect: [200] },
  { method: "GET", path: "/api/products?limit=1", expect: [200, 503] },
  { method: "GET", path: "/api/products/search?q=inkweto&limit=5", expect: [200, 503] },
  { method: "GET", path: "/api/products/search?q=shose&limit=5", expect: [200, 503] },
  { method: "GET", path: "/api/products/search?q=samsng&limit=5", expect: [200, 503] },
  { method: "GET", path: "/api/products/search/suggestions?q=sho&limit=5", expect: [200, 503] },
  { method: "GET", path: "/api/products/search/popular", expect: [200, 503] },
  { method: "POST", path: "/api/products/search/visual", expect: [400, 503] },
  { method: "GET", path: "/api/admin/dashboard", expect: [401, 403] },
  { method: "GET", path: "/api/admin/orders", expect: [401, 403] },
  { method: "GET", path: "/api/admin/customers", expect: [401, 403] },
  { method: "GET", path: "/api/admin/activity?limit=120", expect: [401, 403] },
  { method: "GET", path: "/api/admin/messages?limit=120", expect: [401, 403] },
  { method: "GET", path: "/api/admin/carts?limit=200", expect: [401, 403] },
  { method: "GET", path: "/api/admin/session", expect: [401, 403] },
  { method: "GET", path: "/api/realtime/stream", expect: [401, 403, 200] },
  { method: "GET", path: "/api/realtime/events", expect: [401, 403, 200] },
  { method: "GET", path: "/api/uploads/health", expect: [200] },
  { method: "POST", path: "/api/uploads/products", expect: [401, 403, 404] }
];

function requestRoute(route) {
  const url = new URL(`${baseUrl}${route.path}`);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        method: route.method,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          Accept: "application/json"
        },
        timeout: 10000
      },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Timeout: ${route.path}`));
    });

    req.on("error", reject);
    req.end();
  });
}

async function main() {
  console.log(`[verify-api-routes] Probing ${baseUrl}`);

  let failed = 0;

  for (const route of ROUTES) {
    try {
      const status = await requestRoute(route);
      const ok = route.expect.includes(status);

      if (ok) {
        console.log(`  OK  ${route.method} ${route.path} -> ${status}`);
      } else if (status === 404) {
        console.error(`  FAIL ${route.method} ${route.path} -> 404 (route missing)`);
        failed += 1;
      } else {
        console.error(`  WARN ${route.method} ${route.path} -> ${status} (expected ${route.expect.join("|")})`);
      }
    } catch (error) {
      console.error(`  FAIL ${route.method} ${route.path} -> ${error.message}`);
      failed += 1;
    }
  }

  if (failed) {
    console.error(`[verify-api-routes] FAILED (${failed} route(s) unreachable or 404)`);
    process.exit(1);
  }

  console.log("[verify-api-routes] PASS");
}

main();
