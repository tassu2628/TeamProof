const assert = require("assert").strict;
const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const { app } = require("../server");
const User = require("../models/User");
const { authorizeRoles } = require("../middleware/auth");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

async function run() {
    assert.ok(process.env.MONGO_URI, "MONGO_URI must be configured");
    assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32,
        "JWT_SECRET must be at least 32 characters");

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await User.init();

    const suffix = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    const email = `phase2-test-${suffix}@example.com`;
    const adminAttemptEmail = `phase2-admin-test-${suffix}@example.com`;
    const password = "TeamProof-Test-Password-2026!";
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function request(endpoint, options = {}) {
        const response = await fetch(`${baseUrl}${endpoint}`, options);
        return { status: response.status, data: await response.json() };
    }

    try {
        const missingFields = await request("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Incomplete User" })
        });
        assert.equal(missingFields.status, 400);

        const malformedEmail = await request("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Invalid Email User",
                email: "not-an-email",
                password,
                role: "student"
            })
        });
        assert.equal(malformedEmail.status, 400);
        console.log("PASS required fields and email format validation");

        const signup = await request("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Phase Two Test User",
                email: email.toUpperCase(),
                password,
                role: "student"
            })
        });
        assert.equal(signup.status, 201);
        assert.equal(signup.data.user.email, email);
        assert.ok(signup.data.token);
        assert.equal("passwordHash" in signup.data.user, false);
        console.log("PASS valid signup, normalized email, and safe response");

        const storedUser = await User.findOne({ email }).select("+passwordHash");
        assert.ok(storedUser);
        assert.notEqual(storedUser.passwordHash, password);
        assert.ok(await bcrypt.compare(password, storedUser.passwordHash));
        console.log("PASS password is stored as a bcrypt hash");

        const duplicate = await request("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Duplicate User",
                email,
                password,
                role: "student"
            })
        });
        assert.equal(duplicate.status, 409);
        console.log("PASS duplicate email signup rejected");

        const adminAttempt = await request("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Admin Attempt",
                email: adminAttemptEmail,
                password,
                role: "admin"
            })
        });
        assert.equal(adminAttempt.status, 400);
        assert.equal(await User.exists({ email: adminAttemptEmail }), null);
        console.log("PASS public signup cannot assign admin role");

        const login = await request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.toUpperCase(), password })
        });
        assert.equal(login.status, 200);
        assert.ok(login.data.token);
        assert.equal("passwordHash" in login.data.user, false);
        console.log("PASS successful login returns a JWT and safe profile");

        const badPassword = await request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "Incorrect-Password!" })
        });
        assert.equal(badPassword.status, 401);
        console.log("PASS incorrect password rejected");

        const missingToken = await request("/api/auth/me");
        assert.equal(missingToken.status, 401);
        const invalidToken = await request("/api/auth/me", {
            headers: { Authorization: "Bearer invalid-token" }
        });
        assert.equal(invalidToken.status, 401);
        console.log("PASS missing and invalid JWTs rejected");

        const profile = await request("/api/auth/me", {
            headers: { Authorization: `Bearer ${login.data.token}` }
        });
        assert.equal(profile.status, 200);
        assert.equal(profile.data.user.email, email);
        assert.equal("passwordHash" in profile.data.user, false);
        console.log("PASS authenticated profile endpoint returns safe profile");

        let roleStatus;
        authorizeRoles("admin")(
            { user: { role: "student" } },
            { status(code) { roleStatus = code; return this; }, json() {} },
            () => assert.fail("Student unexpectedly passed admin authorization")
        );
        assert.equal(roleStatus, 403);
        console.log("PASS role middleware rejects student for admin-only access");
    } finally {
        await User.deleteOne({ email });
        await User.deleteOne({ email: adminAttemptEmail });
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect();
    }
}

run().catch(error => {
    console.error(`FAIL auth integration checks: ${error.message}`);
    process.exitCode = 1;
    mongoose.disconnect().finally(() => process.exit());
});
