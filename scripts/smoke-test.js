// Smoke Test Suite for HireLoop Backend API
import "dotenv/config";

const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${PORT}`;

const tests = [
  // 1. Base route
  {
    name: "GET / -> 200 OK (server status)",
    method: "GET",
    path: "/",
    expectedStatus: 200,
    validate: (data, text) => text.includes("Hireloop server is running"),
  },

  // 2. Public Job routes
  {
    name: "GET /jobs -> 200 OK (array)",
    method: "GET",
    path: "/jobs",
    expectedStatus: 200,
    validate: (data) => Array.isArray(data),
  },
  {
    name: "GET /jobs/:id (non-existent ID) -> 200 OK (null)",
    method: "GET",
    path: "/jobs/000000000000000000000000",
    expectedStatus: 200,
  },

  // 3. User routes auth guards
  {
    name: "GET /users (unauthenticated) -> 401 Unauthorized",
    method: "GET",
    path: "/users",
    expectedStatus: 401,
  },
  {
    name: "PATCH /users/:id (unauthenticated) -> 401 Unauthorized",
    method: "PATCH",
    path: "/users/123",
    body: { role: "admin" },
    expectedStatus: 401,
  },
  {
    name: "GET /users/:id/premium (unauthenticated) -> 401 Unauthorized",
    method: "GET",
    path: "/users/123/premium",
    expectedStatus: 401,
  },

  // 4. Job routes auth guards
  {
    name: "POST /jobs (unauthenticated) -> 401 Unauthorized",
    method: "POST",
    path: "/jobs",
    body: { title: "Test Job" },
    expectedStatus: 401,
  },
  {
    name: "PUT /jobs/:id (unauthenticated) -> 401 Unauthorized",
    method: "PUT",
    path: "/jobs/123",
    body: { title: "Updated Job" },
    expectedStatus: 401,
  },
  {
    name: "DELETE /jobs/:id (unauthenticated) -> 401 Unauthorized",
    method: "DELETE",
    path: "/jobs/123",
    expectedStatus: 401,
  },

  // 5. Application routes auth guards
  {
    name: "POST /applications (unauthenticated) -> 401 Unauthorized",
    method: "POST",
    path: "/applications",
    body: { jobId: "123" },
    expectedStatus: 401,
  },
  {
    name: "GET /applications (unauthenticated) -> 401 Unauthorized",
    method: "GET",
    path: "/applications",
    expectedStatus: 401,
  },
  {
    name: "GET /applications/count (unauthenticated) -> 401 Unauthorized",
    method: "GET",
    path: "/applications/count",
    expectedStatus: 401,
  },
  {
    name: "PUT /applications/:id (unauthenticated) -> 401 Unauthorized",
    method: "PUT",
    path: "/applications/123",
    body: { status: "Interview" },
    expectedStatus: 401,
  },

  // 6. Payment & Webhook guards
  {
    name: "POST /payment (unauthenticated) -> 401 Unauthorized",
    method: "POST",
    path: "/payment",
    body: { sessionId: "cs_test_123" },
    expectedStatus: 401,
  },
  {
    name: "POST /webhook/stripe (no signature) -> 400 Bad Request",
    method: "POST",
    path: "/webhook/stripe",
    body: { type: "test" },
    expectedStatus: 400,
  },
];

async function runSmokeTests() {
  console.log(`\n🔍 Starting HireLoop API Smoke Tests against: ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      const options = {
        method: t.method,
        headers: {},
      };

      if (t.body) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(t.body);
      }

      const res = await fetch(`${BASE_URL}${t.path}`, options);
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // Text response
      }

      const statusMatch = res.status === t.expectedStatus;
      const customValidation = t.validate ? t.validate(data, text) : true;

      if (statusMatch && customValidation) {
        console.log(`  ✅ PASS: ${t.name}`);
        passed++;
      } else {
        console.error(
          `  ❌ FAIL: ${t.name} (Expected status ${t.expectedStatus}, got ${res.status})`
        );
        if (text) console.error(`     Response: ${text.slice(0, 150)}`);
        failed++;
      }
    } catch (err) {
      console.error(`  ❌ ERROR: ${t.name} -> ${err.message}`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Smoke Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSmokeTests();
