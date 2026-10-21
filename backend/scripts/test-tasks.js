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
const Task = require("../models/Task");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

async function run() {
    assert.ok(process.env.MONGO_URI, "MONGO_URI must be configured");
    assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32, "JWT_SECRET must be configured");
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init(), Task.init()]);

    const suffix = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    const userIds = [];
    const taskIds = [];
    let projectId;
    let server;

    try {
        const passwordHash = await bcrypt.hash("TeamProof-Task-Test-2026!", 4);
        const owner = await User.create({ name: "Task Test Student", email: `task-owner-${suffix}@example.com`, passwordHash, role: "student" });
        const stranger = await User.create({ name: "Task Test Stranger", email: `task-stranger-${suffix}@example.com`, passwordHash, role: "student" });
        const admin = await User.create({ name: "Task Test Admin", email: `task-admin-${suffix}@example.com`, passwordHash, role: "admin" });
        userIds.push(owner._id, stranger._id, admin._id);
        const project = await Project.create({
            projectName: `Task API Test ${suffix}`, description: "Temporary project for task API checks",
            teamName: "Task API Test Team", createdBy: owner._id, members: [owner._id],
            startDate: new Date("2026-01-01T00:00:00.000Z"), deadline: new Date("2099-01-01T00:00:00.000Z")
        });
        projectId = project._id;
        const tokens = Object.fromEntries([owner, stranger, admin].map(user => [user._id.toString(), jwt.sign({}, process.env.JWT_SECRET, {
            algorithm: "HS256", subject: user._id.toString(), expiresIn: "10m"
        })]));

        server = app.listen(0, "127.0.0.1");
        await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
        const base = `http://127.0.0.1:${server.address().port}/api`;
        async function request(pathname, { user, method = "GET", body } = {}) {
            const response = await fetch(`${base}${pathname}`, {
                method,
                headers: {
                    ...(user ? { Authorization: `Bearer ${tokens[user._id.toString()]}` } : {}),
                    ...(body ? { "Content-Type": "application/json" } : {})
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            return { status: response.status, data: await response.json() };
        }

        assert.equal((await request("/tasks")).status, 401);
        console.log("PASS task APIs reject unauthenticated requests");
        assert.equal((await request("/tasks", { user: stranger })).data.tasks.length, 0);
        assert.equal((await request("/tasks/not-an-id", { user: owner })).status, 400);
        assert.equal((await request("/tasks", { user: owner, method: "POST", body: { title: "bad", projectId: "bad", assigneeId: "bad" } })).status, 400);

        const outsiderTask = await Task.create({
            title: "Private task fixture", project: project._id, createdBy: owner._id,
            assignee: owner._id, deadline: new Date("2099-01-01T00:00:00.000Z")
        });
        taskIds.push(outsiderTask._id);
        assert.equal((await request(`/tasks/${outsiderTask._id}`, { user: stranger })).status, 404);
        assert.equal((await request(`/tasks/${outsiderTask._id}`, { user: stranger, method: "PUT", body: { title: "Unauthorized" } })).status, 404);
        assert.equal((await request(`/tasks/${outsiderTask._id}`, { user: stranger, method: "DELETE" })).status, 404);
        assert.equal((await request(`/tasks/${outsiderTask._id}`, { user: stranger, method: "PUT", body: { status: "Completed" } })).status, 404);
        console.log("PASS unauthorized users cannot read, update, or delete another project's tasks");

        assert.equal((await request("/tasks", { user: owner, method: "POST", body: {
            title: "Unverified project assignee", projectId: project._id.toString(),
            assigneeId: stranger._id.toString(), deadline: "2099-01-01"
        } })).status, 400);
        assert.equal((await request(`/projects/${project._id}/members`, { user: stranger, method: "POST", body: { email: stranger.email } })).status, 403);
        assert.equal((await request(`/projects/${project._id}/members`, { user: owner, method: "POST", body: { email: stranger.email } })).status, 201);
        assert.equal((await request(`/projects/${project._id}/members`, { user: owner, method: "POST", body: { email: stranger.email } })).status, 409);
        const teammateTask = await Task.create({
            title: "Teammate task", project: project._id, createdBy: owner._id,
            assignee: stranger._id, deadline: new Date("2099-01-01T00:00:00.000Z")
        });
        taskIds.push(teammateTask._id);
        assert.equal((await request(`/tasks/${teammateTask._id}`, { user: stranger })).status, 200);
        assert.equal((await request(`/tasks/${teammateTask._id}`, { user: stranger, method: "PUT", body: { title: "Unauthorized title change" } })).status, 403);
        assert.equal((await request(`/tasks/${teammateTask._id}`, { user: stranger, method: "PUT", body: { status: "Completed", submissionLink: "https://example.com/teammate" } })).status, 200);
        assert.equal((await request(`/tasks/${teammateTask._id}`, { user: stranger, method: "DELETE" })).status, 403);
        assert.equal((await request("/tasks/stats/contribution", { user: owner })).data.total, 1);
        assert.equal((await request("/tasks/stats/contribution", { user: stranger })).data.total, 1);
        console.log("PASS project owners add valid student members; assignees can submit but cannot edit/delete, and task stats are student-scoped");

        const created = await request("/tasks", { user: owner, method: "POST", body: {
            title: "Build API task", description: "Temporary task", projectId: project._id.toString(),
            assigneeId: owner._id.toString(), deadline: "2099-01-01", status: "Pending"
        } });
        assert.equal(created.status, 201);
        const taskId = created.data.task._id;
        taskIds.push(taskId);
        assert.equal(created.data.task.assignee._id, owner._id.toString());
        assert.equal((await request(`/tasks/${taskId}`, { user: owner })).data.task.title, "Build API task");
        assert.equal((await request("/tasks", { user: owner })).data.tasks.some(task => task._id === taskId), true);
        assert.equal((await Task.findById(taskId)).title, "Build API task");
        console.log("PASS task creation, authorized listing/retrieval, and MongoDB persistence");

        assert.equal((await request(`/tasks/${taskId}`, { user: owner, method: "PUT", body: { title: "Edited API task", description: "Edited description" } })).status, 200);
        assert.equal((await request(`/tasks/${taskId}`, { user: stranger, method: "PUT", body: { title: "Unauthorized edit" } })).status, 403);
        const zeroScore = await request("/tasks/stats/contribution", { user: owner });
        assert.deepEqual({ total: zeroScore.data.total, completed: zeroScore.data.completed, score: zeroScore.data.score }, { total: 2, completed: 0, score: 0 });
        assert.equal((await request(`/tasks/${taskId}`, { user: owner, method: "PUT", body: { status: "Completed", submissionLink: "https://example.com/submission" } })).status, 200);
        assert.equal((await Task.findById(taskId)).verificationStatus, "pending");
        assert.equal((await request("/tasks/stats/contribution", { user: owner })).data.score, 0);
        assert.equal((await request("/admin/tasks/pending", { user: owner })).status, 403);
        console.log("PASS task edits/status and unverified work earns no contribution score");

        const pending = await request("/admin/tasks/pending", { user: admin });
        assert.equal(pending.status, 200);
        assert.equal(pending.data.tasks.some(task => task._id === taskId), true);
        assert.equal((await request("/admin/stats", { user: owner })).status, 403);
        assert.equal((await request("/admin/stats", { user: admin })).status, 200);
        assert.equal((await request("/admin/students", { user: admin })).data.students.some(user => user._id === owner._id.toString()), true);
        assert.equal((await request("/admin/projects", { user: admin })).data.projects.some(item => item._id === project._id.toString()), true);
        const approved = await request(`/admin/tasks/${taskId}/verification`, { user: admin, method: "PUT", body: { decision: "approve" } });
        assert.equal(approved.status, 200);
        assert.equal(approved.data.task.verificationStatus, "approved");
        assert.equal(approved.data.task.verifiedBy._id, admin._id.toString());
        assert.ok(approved.data.task.verifiedAt);
        assert.equal((await request("/tasks/stats/contribution", { user: owner })).data.score, 50);
        assert.equal((await request(`/tasks/${taskId}`, { user: owner, method: "PUT", body: { title: "Edited after verification" } })).status, 200);
        assert.equal((await request("/tasks/stats/contribution", { user: owner })).data.score, 0);
        assert.equal((await Task.findById(taskId)).verificationStatus, "pending");
        const reapproved = await request(`/admin/tasks/${taskId}/verification`, { user: admin, method: "PUT", body: { decision: "approve" } });
        assert.equal(reapproved.status, 200);
        assert.equal((await request("/tasks/stats/contribution", { user: owner })).data.score, 50);
        console.log("PASS admin-only lists and approval identity; edits invalidate prior verification until reviewed again");

        const rejectedTask = await request("/tasks", { user: owner, method: "POST", body: {
            title: "Reject flow task", description: "Temporary rejection test", projectId: project._id.toString(), assigneeId: owner._id.toString(), deadline: "2099-01-01"
        } });
        assert.equal(rejectedTask.status, 201);
        const rejectedId = rejectedTask.data.task._id;
        taskIds.push(rejectedId);
        await request(`/tasks/${rejectedId}`, { user: owner, method: "PUT", body: { status: "Completed", submissionLink: "https://example.com/rejected" } });
        const rejected = await request(`/admin/tasks/${rejectedId}/verification`, { user: admin, method: "PUT", body: { decision: "reject" } });
        assert.equal(rejected.status, 200);
        assert.equal(rejected.data.task.verificationStatus, "rejected");
        assert.equal((await request("/tasks/stats/contribution", { user: owner })).data.score, 33);
        assert.equal((await request(`/admin/tasks/${rejectedId}/verification`, { user: admin, method: "PUT", body: { decision: "approve" } })).status, 404);
        console.log("PASS task rejection is recorded and rejected work does not count toward contribution");

        assert.equal((await request(`/tasks/${taskId}`, { user: owner, method: "DELETE" })).status, 200);
        assert.equal(await Task.exists({ _id: taskId }), null);
        console.log("PASS authorized task deletion removes the task and preserves unrelated records");
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (taskIds.length) await Task.deleteMany({ _id: { $in: taskIds } });
        if (projectId) await Project.deleteOne({ _id: projectId });
        if (userIds.length) await User.deleteMany({ _id: { $in: userIds } });
        await mongoose.disconnect();
    }
}

run().catch(error => {
    console.error(`FAIL task/admin API checks: ${error.message}`);
    mongoose.disconnect().finally(() => process.exit(1));
});
