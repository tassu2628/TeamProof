const assert = require("assert").strict;
const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { app } = require("../server");
const User = require("../models/User");
const Project = require("../models/Project");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

async function run() {
    assert.ok(process.env.MONGO_URI, "MONGO_URI must be configured");
    assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32,
        "JWT_SECRET must be at least 32 characters");
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init()]);

    const suffix = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    const createdUsers = [];
    let projectId = null;
    let server = null;

    try {
        const passwordHash = await bcrypt.hash("TeamProof-Project-Test-2026!", 4);
        const owner = await User.create({
            name: "Project Test Owner",
            email: `project-owner-${suffix}@example.com`,
            passwordHash,
            role: "student"
        });
        createdUsers.push(owner._id);
        const member = await User.create({
            name: "Project Test Member",
            email: `project-member-${suffix}@example.com`,
            passwordHash,
            role: "student"
        });
        createdUsers.push(member._id);

        const ownerToken = jwt.sign({}, process.env.JWT_SECRET, {
            algorithm: "HS256",
            subject: owner._id.toString(),
            expiresIn: "10m"
        });
        const memberToken = jwt.sign({}, process.env.JWT_SECRET, {
            algorithm: "HS256",
            subject: member._id.toString(),
            expiresIn: "10m"
        });

        server = app.listen(0, "127.0.0.1");
        await new Promise((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        async function request(method, endpoint, token, body) {
            const headers = {};
            if (token) headers.Authorization = `Bearer ${token}`;
            if (body !== undefined) headers["Content-Type"] = "application/json";
            const response = await fetch(`${baseUrl}${endpoint}`, {
                method,
                headers,
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            const data = await response.json();
            return { status: response.status, data };
        }

        const missingAuth = await Promise.all([
            request("POST", "/api/projects", null, {}),
            request("GET", "/api/projects", null),
            request("GET", "/api/projects/not-an-id", null),
            request("PUT", "/api/projects/not-an-id", null, {}),
            request("DELETE", "/api/projects/not-an-id", null)
        ]);
        assert.deepEqual(missingAuth.map(result => result.status), [401, 401, 401, 401, 401]);
        console.log("PASS all project endpoints reject unauthenticated requests");

        const invalidCreate = await request("POST", "/api/projects", ownerToken, {
            projectName: "Incomplete project"
        });
        assert.equal(invalidCreate.status, 400);
        const invalidDate = await request("POST", "/api/projects", ownerToken, {
            projectName: "Invalid date project",
            description: "Must be rejected",
            teamName: "Test Team",
            deadline: "2099-02-31"
        });
        assert.equal(invalidDate.status, 400);
        console.log("PASS project creation validates required fields and calendar dates");

        const today = new Date();
        const future = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);
        const create = await request("POST", "/api/projects", ownerToken, {
            projectName: "Phase 3 integration project",
            description: "Temporary API test project",
            teamName: "Test Team",
            deadline: future,
            createdBy: member._id.toString(),
            members: [member._id.toString()]
        });
        projectId = create.data.project && create.data.project._id;
        assert.equal(create.status, 201, JSON.stringify(create.data));
        assert.equal(create.data.project.createdBy, owner._id.toString());
        assert.deepEqual(create.data.project.members, [owner._id.toString()]);
        assert.ok(create.data.project.createdAt && create.data.project.updatedAt);
        console.log("PASS create derives owner from JWT and ignores client ownership fields");

        const ownerList = await request("GET", "/api/projects", ownerToken);
        assert.ok(ownerList.data.projects.some(project => project._id === projectId));
        const refreshList = await request("GET", "/api/projects", ownerToken);
        assert.ok(refreshList.data.projects.some(project => project._id === projectId));
        console.log("PASS authenticated listing and persistence after a fresh request");

        const memberListBefore = await request("GET", "/api/projects", memberToken);
        assert.equal(memberListBefore.data.projects.some(project => project._id === projectId), false);
        const outsiderGet = await request("GET", `/api/projects/${projectId}`, memberToken);
        assert.equal(outsiderGet.status, 404);
        console.log("PASS unrelated users cannot list or retrieve the project");

        const ownerGet = await request("GET", `/api/projects/${projectId}`, ownerToken);
        assert.equal(ownerGet.status, 200);
        assert.equal(ownerGet.data.project.projectName, "Phase 3 integration project");
        console.log("PASS project retrieval by owner");

        const invalidIds = await Promise.all([
            request("GET", "/api/projects/not-an-id", ownerToken),
            request("PUT", "/api/projects/not-an-id", ownerToken, { projectName: "Bad" }),
            request("DELETE", "/api/projects/not-an-id", ownerToken)
        ]);
        assert.deepEqual(invalidIds.map(result => result.status), [400, 400, 400]);
        console.log("PASS invalid MongoDB IDs rejected for get, update, and delete");

        const outsiderUpdate = await request("PUT", `/api/projects/${projectId}`, memberToken, {
            projectName: "Unauthorized edit"
        });
        const outsiderDelete = await request("DELETE", `/api/projects/${projectId}`, memberToken);
        assert.equal(outsiderUpdate.status, 404);
        assert.equal(outsiderDelete.status, 404);
        console.log("PASS non-members cannot modify or delete the project");

        await Project.updateOne({ _id: projectId }, { $addToSet: { members: member._id } });
        const memberList = await request("GET", "/api/projects", memberToken);
        assert.ok(memberList.data.projects.some(project => project._id === projectId));
        const memberGet = await request("GET", `/api/projects/${projectId}`, memberToken);
        assert.equal(memberGet.status, 200);
        const memberUpdate = await request("PUT", `/api/projects/${projectId}`, memberToken, {
            description: "Member should not edit"
        });
        const memberDelete = await request("DELETE", `/api/projects/${projectId}`, memberToken);
        assert.equal(memberUpdate.status, 403);
        assert.equal(memberDelete.status, 403);
        console.log("PASS members can view shared projects but cannot edit or delete them");

        const update = await request("PUT", `/api/projects/${projectId}`, ownerToken, {
            projectName: "Updated Phase 3 project",
            description: "Updated temporary project",
            teamName: "Updated Team",
            deadline: future
        });
        assert.equal(update.status, 200);
        assert.equal(update.data.project.projectName, "Updated Phase 3 project");
        assert.equal(update.data.project.teamName, "Updated Team");
        console.log("PASS owner edits project fields");

        const remove = await request("DELETE", `/api/projects/${projectId}`, ownerToken);
        assert.equal(remove.status, 200);
        projectId = null;
        console.log("PASS owner deletes project");
    } finally {
        if (projectId) await Project.deleteOne({ _id: projectId });
        for (const userId of createdUsers) await User.deleteOne({ _id: userId });
        if (server) await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect();
    }
}

run().catch(error => {
    console.error(`FAIL project integration checks: ${error.message}`);
    process.exitCode = 1;
    mongoose.disconnect().finally(() => process.exit());
});
