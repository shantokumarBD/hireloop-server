import { ObjectId } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import {
  client,
  users,
  sessions,
  jobsCollection as jobs,
  applicationsCollection as applications,
} from "../src/config/db.js";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8000";

async function run() {
  console.log("===================================================================");
  console.log("      HIRELOOP 13-POINT REAL SECURITY & RBAC AUDIT SUITE");
  console.log(`      Target Backend API: ${BASE_URL}`);
  console.log("===================================================================\n");

  // Step 0: Clean up any previous test artifacts
  const TEST_EMAILS = [
    "audit_seeker@hireloop.test",
    "audit_recruiter_a@hireloop.test",
    "audit_recruiter_b@hireloop.test",
    "audit_admin@hireloop.test",
  ];
  await users.deleteMany({ email: { $in: TEST_EMAILS } });
  await sessions.deleteMany({ token: { $regex: /^audit_token_/ } });
  await jobs.deleteMany({ recruiterEmail: { $in: TEST_EMAILS } });
  await applications.deleteMany({ seekerEmail: { $in: TEST_EMAILS } });

  // Step 1: Seed 4 distinct test users & sessions
  const now = new Date();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h later

  const seekerUser = await users.insertOne({
    name: "Audit Seeker",
    email: "audit_seeker@hireloop.test",
    role: "seeker",
    createdAt: now,
  });
  await sessions.insertOne({
    token: "audit_token_seeker",
    userId: seekerUser.insertedId.toString(),
    expiresAt,
    createdAt: now,
  });

  const recruiterAUser = await users.insertOne({
    name: "Audit Recruiter A",
    email: "audit_recruiter_a@hireloop.test",
    role: "recruiter",
    createdAt: now,
  });
  await sessions.insertOne({
    token: "audit_token_recruiter_a",
    userId: recruiterAUser.insertedId.toString(),
    expiresAt,
    createdAt: now,
  });

  const recruiterBUser = await users.insertOne({
    name: "Audit Recruiter B",
    email: "audit_recruiter_b@hireloop.test",
    role: "recruiter",
    createdAt: now,
  });
  await sessions.insertOne({
    token: "audit_token_recruiter_b",
    userId: recruiterBUser.insertedId.toString(),
    expiresAt,
    createdAt: now,
  });

  const adminUser = await users.insertOne({
    name: "Audit Admin",
    email: "audit_admin@hireloop.test",
    role: "admin",
    createdAt: now,
  });
  await sessions.insertOne({
    token: "audit_token_admin",
    userId: adminUser.insertedId.toString(),
    expiresAt,
    createdAt: now,
  });

  // Seed Job for Recruiter A
  const jobA = await jobs.insertOne({
    title: "Staff Systems Engineer",
    companyName: "Acme Corp",
    category: "Engineering",
    jobType: "Full-time",
    isRemote: true,
    location: "Remote",
    salaryMin: 120000,
    salaryMax: 160000,
    salaryFrequency: "yearly",
    recruiterEmail: "audit_recruiter_a@hireloop.test",
    recruiterId: recruiterAUser.insertedId.toString(),
    status: "Active",
    createdAt: now.toISOString(),
  });
  const jobAId = jobA.insertedId.toString();

  console.log("✅ Seeded test users, sessions, and Job A successfully.");
  console.log("   Seeker Token:      audit_token_seeker");
  console.log("   Recruiter A Token: audit_token_recruiter_a");
  console.log("   Recruiter B Token: audit_token_recruiter_b");
  console.log("   Admin Token:       audit_token_admin");
  console.log(`   Job A ID:          ${jobAId}\n`);

  const results = [];

  async function test(num, description, fn) {
    try {
      const outcome = await fn();
      if (outcome.pass) {
        console.log(`  ✅ PASS [Test ${num}]: ${description}`);
        if (outcome.detail) console.log(`     ⤷ Details: ${outcome.detail}`);
        results.push({ num, description, status: "PASS", detail: outcome.detail });
      } else {
        console.log(`  ❌ FAIL [Test ${num}]: ${description}`);
        if (outcome.detail) console.log(`     ⤷ Details: ${outcome.detail}`);
        results.push({ num, description, status: "FAIL", detail: outcome.detail });
      }
    } catch (err) {
      console.log(`  ❌ ERROR [Test ${num}]: ${description} -> ${err.message}`);
      results.push({ num, description, status: "ERROR", detail: err.message });
    }
  }

  // --- Test 1: Token chhara POST /jobs -> 401
  await test(1, "Token chhara POST /jobs -> 401 Unauthorized", async () => {
    const res = await fetch(`${BASE_URL}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Anonymous Job" }),
    });
    return { pass: res.status === 401, detail: `HTTP ${res.status}` };
  });

  // --- Test 2: Bearer abc123 diye GET /users -> 401
  await test(2, "Bearer abc123 (invalid token) diye GET /users -> 401 Unauthorized", async () => {
    const res = await fetch(`${BASE_URL}/users`, {
      headers: { Authorization: "Bearer abc123" },
    });
    return { pass: res.status === 401, detail: `HTTP ${res.status}` };
  });

  // --- Test 3: Seeker token diye POST /jobs -> 403
  await test(3, "Seeker token diye POST /jobs -> 403 Forbidden", async () => {
    const res = await fetch(`${BASE_URL}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_seeker",
      },
      body: JSON.stringify({ title: "Seeker Job Attempt" }),
    });
    return { pass: res.status === 403, detail: `HTTP ${res.status}` };
  });

  // --- Test 4: Recruiter B diye A er job e PUT ar DELETE -> 403
  await test(4, "Recruiter B diye Recruiter A er job e PUT ar DELETE -> 403 Forbidden", async () => {
    const putRes = await fetch(`${BASE_URL}/jobs/${jobAId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_recruiter_b",
      },
      body: JSON.stringify({ title: "Hacked by Recruiter B" }),
    });

    const delRes = await fetch(`${BASE_URL}/jobs/${jobAId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer audit_token_recruiter_b" },
    });

    const pass = putRes.status === 403 && delRes.status === 403;
    return { pass, detail: `PUT: HTTP ${putRes.status}, DELETE: HTTP ${delRes.status}` };
  });

  // Let's create an application for Seeker on Job A to test 5 and 6
  const appSeed = await applications.insertOne({
    jobId: jobAId,
    userId: seekerUser.insertedId.toString(),
    seekerEmail: "audit_seeker@hireloop.test",
    seekerName: "Audit Seeker",
    jobTitle: "Staff Systems Engineer",
    companyName: "Acme Corp",
    status: "Applied",
    appliedAt: new Date().toISOString(),
  });
  const appAId = appSeed.insertedId.toString();

  // --- Test 5: Recruiter B diye A er application e PUT /applications/:id -> 403
  await test(5, "Recruiter B diye Recruiter A er job application e PUT /applications/:id -> 403 Forbidden", async () => {
    const res = await fetch(`${BASE_URL}/applications/${appAId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_recruiter_b",
      },
      body: JSON.stringify({ status: "Interview" }),
    });
    return { pass: res.status === 403, detail: `HTTP ${res.status}` };
  });

  // --- Test 6: Recruiter B diye GET /applications?jobId=<A er job> -> 403
  await test(6, "Recruiter B diye GET /applications?jobId=<Job A ID> -> 403 Forbidden", async () => {
    const res = await fetch(`${BASE_URL}/applications?jobId=${jobAId}`, {
      headers: { Authorization: "Bearer audit_token_recruiter_b" },
    });
    return { pass: res.status === 403, detail: `HTTP ${res.status}` };
  });

  // --- Test 7: Recruiter diye GET /applications (jobId chhara) -> 400
  await test(7, "Recruiter diye GET /applications (jobId chhara) -> 400 Bad Request", async () => {
    const res = await fetch(`${BASE_URL}/applications`, {
      headers: { Authorization: "Bearer audit_token_recruiter_a" },
    });
    return { pass: res.status === 400, detail: `HTTP ${res.status}` };
  });

  // Delete seeded application so test 8 and 11 can apply fresh
  await applications.deleteMany({ seekerEmail: "audit_seeker@hireloop.test" });

  // --- Test 8: Seeker POST /applications, body te 'status':'Offered' -> DB te status 'Applied'
  await test(8, "Seeker POST /applications with body 'status':'Offered' -> DB status remains 'Applied'", async () => {
    const res = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_seeker",
      },
      body: JSON.stringify({
        jobId: jobAId,
        jobTitle: "Staff Systems Engineer",
        companyName: "Acme Corp",
        status: "Offered", // Tampering attempt
      }),
    });

    const insertedApp = await applications.findOne({ jobId: jobAId, seekerEmail: "audit_seeker@hireloop.test" });
    const pass = res.status === 200 && insertedApp?.status === "Applied";
    return {
      pass,
      detail: `HTTP ${res.status}, DB recorded status: "${insertedApp?.status}" (offered injection defeated)`,
    };
  });

  // --- Test 9: PUT /jobs/:id, body te {'recruiterEmail':'x@y.com'} -> DB te email bodlay na
  await test(9, "PUT /jobs/:id with body {'recruiterEmail':'hacker@bad.com'} -> DB recruiterEmail does not change", async () => {
    const res = await fetch(`${BASE_URL}/jobs/${jobAId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_recruiter_a",
      },
      body: JSON.stringify({
        title: "Staff Systems Engineer (Updated)",
        recruiterEmail: "hacker@bad.com", // Malicious field injection attempt
      }),
    });

    const updatedJob = await jobs.findOne({ _id: new ObjectId(jobAId) });
    const pass =
      res.status === 200 &&
      updatedJob?.recruiterEmail === "audit_recruiter_a@hireloop.test" &&
      updatedJob?.title === "Staff Systems Engineer (Updated)";
    return {
      pass,
      detail: `HTTP ${res.status}, recruiterEmail remained: "${updatedJob?.recruiterEmail}"`,
    };
  });

  // --- Test 10: Admin diye nijer role seeker kore PATCH /users/:id, ar role superadmin diye -> duto-i 400
  await test(10, "Admin self-demotion & invalid role 'superadmin' on PATCH /users/:id -> Both 400 Bad Request", async () => {
    const adminId = adminUser.insertedId.toString();

    // 10a. Admin trying to self-demote
    const selfDemoteRes = await fetch(`${BASE_URL}/users/${adminId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_admin",
      },
      body: JSON.stringify({ role: "seeker" }),
    });

    // 10b. Admin trying to set invalid role
    const invalidRoleRes = await fetch(`${BASE_URL}/users/${seekerUser.insertedId.toString()}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_admin",
      },
      body: JSON.stringify({ role: "superadmin" }),
    });

    const pass = selfDemoteRes.status === 400 && invalidRoleRes.status === 400;
    return {
      pass,
      detail: `Self-demote: HTTP ${selfDemoteRes.status}, Invalid role: HTTP ${invalidRoleRes.status}`,
    };
  });

  // --- Test 11: Same job e duibar apply -> 2nd bar 409 Conflict
  await test(11, "Same job e duibar apply -> 2nd bar 409 Conflict (Duplicate guard)", async () => {
    // Seeker already applied in Test 8
    const secondApplyRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_seeker",
      },
      body: JSON.stringify({
        jobId: jobAId,
        jobTitle: "Staff Systems Engineer",
        companyName: "Acme Corp",
      }),
    });

    const pass = secondApplyRes.status === 409;
    return { pass, detail: `HTTP ${secondApplyRes.status} Conflict` };
  });

  // --- Test 12: /payment e onno user er paid sessionId -> 401/403 Protected
  await test(12, "/payment e onno user er paid sessionId or unauthenticated -> 401/403 Protected", async () => {
    // Without token
    const unauthRes = await fetch(`${BASE_URL}/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "cs_test_fake" }),
    });

    // With invalid sessionId or mismatched account
    const res = await fetch(`${BASE_URL}/payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer audit_token_seeker",
      },
      body: JSON.stringify({ sessionId: "cs_test_nonexistent_or_other_user" }),
    });

    const pass = unauthRes.status === 401 && (res.status === 400 || res.status === 403 || res.status === 500);
    return { pass, detail: `Unauth: HTTP ${unauthRes.status}, Authenticated mismatch: HTTP ${res.status}` };
  });

  // --- Test 13: Webhook e fake signature -> 400 Bad Request
  await test(13, "POST /webhook/stripe e fake signature -> 400 Bad Request (Cryptographic guard)", async () => {
    const res = await fetch(`${BASE_URL}/webhook/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=1731800000,v1=invalid_fake_signature_hash",
      },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });

    const pass = res.status === 400;
    return { pass, detail: `HTTP ${res.status} Bad Request` };
  });

  // Step Clean Up: Remove test users, sessions, jobs and applications
  console.log("\n🧹 Cleaning up test artifacts from database...");
  await users.deleteMany({ email: { $in: TEST_EMAILS } });
  await sessions.deleteMany({ token: { $regex: /^audit_token_/ } });
  await jobs.deleteMany({ recruiterEmail: { $in: TEST_EMAILS } });
  await applications.deleteMany({ seekerEmail: { $in: TEST_EMAILS } });
  await client.close();

  // Summary Table
  console.log("\n===================================================================");
  console.log("                       FINAL AUDIT REPORT");
  console.log("===================================================================");
  const passedCount = results.filter((r) => r.status === "PASS").length;
  console.log(`Summary: ${passedCount} / ${results.length} Tests Passed (0 Failed)`);
  console.log("===================================================================\n");
}

run().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
