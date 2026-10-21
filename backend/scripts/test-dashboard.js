const assert = require("assert").strict;
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const express = require("express");
const { app } = require("../server");
const User = require("../models/User");
const Project = require("../models/Project");
const Task = require("../models/Task");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const workspaceRoot = path.resolve(__dirname, "..", "..");
const allowedFiles = new Map([
    ["/dashboard.html", ["dashboard.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
    ["/dashboard-projects.js", ["dashboard-projects.js", "text/javascript; charset=utf-8"]],
    ["/dashboard-tasks.js", ["dashboard-tasks.js", "text/javascript; charset=utf-8"]],
    ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
    ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]]
]);

async function waitFor(check, label, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await check();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for ${label}.`);
}

async function run() {
    assert.ok(process.env.MONGO_URI, "MONGO_URI must be configured");
    assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32,
        "JWT_SECRET must be at least 32 characters");
    const chrome = process.env.CHROME_PATH ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    assert.ok(fs.existsSync(chrome), "Set CHROME_PATH to a Chrome-compatible browser executable.");

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init(), Task.init()]);

    const suffix = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    const projectName = `Dashboard browser test ${suffix}`;
    const profileDir = path.join(os.tmpdir(), `teamproof-dashboard-${process.pid}`);
    const remotePort = 12000 + crypto.randomInt(0, 40000);
    let user = null;
    let adminUser = null;
    let adminToken = null;
    let taskProject = null;
    let apiServer = null;
    let pageServer = null;
    let browser = null;
    let socket = null;
    let pageTarget = null;
    let nextId = 0;
    const pending = new Map();

    try {
        user = await User.create({
            name: "Dashboard Browser Test",
            email: `dashboard-${suffix}@example.com`,
            passwordHash: await bcrypt.hash("Dashboard-Test-Password!", 4),
            role: "student"
        });
        adminUser = await User.create({
            name: "Dashboard Browser Admin",
            email: `dashboard-admin-${suffix}@example.com`,
            passwordHash: await bcrypt.hash("Dashboard-Admin-Password!", 4),
            role: "admin"
        });
        adminToken = jwt.sign({}, process.env.JWT_SECRET, {
            algorithm: "HS256", subject: adminUser._id.toString(), expiresIn: "10m"
        });
        taskProject = await Project.create({
            projectName: `Task Dashboard Fixture ${suffix}`,
            description: "Temporary task dashboard fixture",
            teamName: "Dashboard Browser Test",
            createdBy: user._id,
            members: [user._id],
            startDate: new Date("2026-01-01T00:00:00.000Z"),
            deadline: new Date("2099-01-01T00:00:00.000Z")
        });
        const token = jwt.sign({}, process.env.JWT_SECRET, {
            algorithm: "HS256",
            subject: user._id.toString(),
            expiresIn: "10m"
        });

        apiServer = app.listen(5001);
        await new Promise((resolve, reject) => {
            apiServer.once("listening", resolve);
            apiServer.once("error", reject);
        });

        const pageApp = express();
        pageApp.get("*path", (req, res) => {
            const file = allowedFiles.get(req.path);
            if (!file) return res.sendStatus(404);
            res.type(file[1]).sendFile(path.join(workspaceRoot, file[0]));
        });
        pageServer = pageApp.listen(5501, "127.0.0.1");
        await new Promise((resolve, reject) => {
            pageServer.once("listening", resolve);
            pageServer.once("error", reject);
        });

        browser = spawn(chrome, [
            "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
            "--no-default-browser-check", `--remote-debugging-port=${remotePort}`,
            `--user-data-dir=${profileDir}`, "about:blank"
        ], { stdio: "ignore" });

        const targets = await waitFor(async () => {
            try {
                const response = await fetch(`http://127.0.0.1:${remotePort}/json/list`);
                if (!response.ok) return null;
                return await response.json();
            } catch (error) {
                return null;
            }
        }, "Chrome DevTools endpoint");
        pageTarget = targets.find(target => target.type === "page");
        assert.ok(pageTarget, "Chrome page target was not found.");
        socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, { once: true });
            socket.addEventListener("error", reject, { once: true });
        });

        socket.addEventListener("message", event => {
            const message = JSON.parse(event.data);
            if (message.method === "Page.javascriptDialogOpening") {
                send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
            }
            if (message.id && pending.has(message.id)) {
                const entry = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) entry.reject(new Error(message.error.message));
                else entry.resolve(message.result);
            }
        });

        function send(method, params = {}) {
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            });
        }

        async function evaluate(expression) {
            const result = await send("Runtime.evaluate", {
                expression,
                returnByValue: true,
                awaitPromise: true
            });
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
            }
            return result.result.value;
        }

        await send("Page.enable");
        await send("Runtime.enable");
        await send("Page.addScriptToEvaluateOnNewDocument", {
            source: `window.TEAMPROOF_API_BASE_URL = "http://localhost:5000/api"; ` +
                `if (!sessionStorage.getItem("teamproofToken")) sessionStorage.setItem("teamproofToken", ${JSON.stringify(token)}); ` +
                `localStorage.setItem("teamproofProjects", JSON.stringify([{name:"Legacy test record"}])); ` +
                `if (!localStorage.getItem("teamproofTasks")) localStorage.setItem("teamproofTasks", JSON.stringify([])); ` +
                `const nativeFetch = window.fetch.bind(window); window.fetch = (input, options) => ` +
                `nativeFetch(typeof input === "string" ? input.replace("localhost:5000", "localhost:5001") : input, options);`
        });
        await send("Page.navigate", { url: "http://127.0.0.1:5501/dashboard.html" });

        await waitFor(async () => evaluate(
            `document.querySelector(".dashboard-user .user-name")?.textContent === "Dashboard Browser Test"`
        ), "authenticated dashboard profile");
        assert.equal(await evaluate("document.querySelector('.back-home-btn')?.getAttribute('href')"), "index.html");
        assert.equal(await evaluate("document.getElementById('legacy-projects-notice').hidden"), false);
        assert.equal(await evaluate("JSON.parse(localStorage.getItem('teamproofProjects')).length"), 1);
        console.log("PASS dashboard loads the authenticated profile and preserves legacy localStorage data");
        console.log("PASS existing dashboard back-home navigation is present");

        await send("Emulation.setDeviceMetricsOverride", {
            width: 1280, height: 900, deviceScaleFactor: 1, mobile: false
        });
        await waitFor(async () => evaluate("document.querySelector('.saved-project-card') !== null"), "authorized project fixture on dashboard");
        await evaluate("document.getElementById('add-task-btn').click()");
        await waitFor(async () => evaluate("document.getElementById('task-assignee')?.options.length > 0"), "project member options");
        assert.equal(await evaluate("getComputedStyle(document.getElementById('task-form')).gridTemplateColumns.split(' ').length"), 2);
        await send("Emulation.setDeviceMetricsOverride", {
            width: 390, height: 844, deviceScaleFactor: 1, mobile: true
        });
        assert.equal(await evaluate("getComputedStyle(document.getElementById('task-form')).gridTemplateColumns.split(' ').length"), 1);
        await evaluate("document.getElementById('close-task-modal').click()");
        console.log("PASS Add Task modal uses two columns on desktop and one on mobile");

        await evaluate("document.getElementById('add-task-btn').click()");
        await evaluate("document.getElementById('task-name').value = 'Browser test assigned task'");
        await evaluate("document.getElementById('task-deadline').value = '2099-01-01'");
        await waitFor(async () => evaluate("document.getElementById('task-assignee')?.options.length > 0"), "assignee list in add modal");
        await evaluate("document.getElementById('task-form').requestSubmit()");
        await waitFor(async () => evaluate("document.getElementById('assigned-tasks').textContent === '1'"), "assigned task count");
        assert.equal(await evaluate("document.getElementById('contribution-percentage').textContent"), "0%");
        console.log("PASS creating an incomplete assigned task updates task counts without awarding contribution");

        await evaluate("document.querySelector('.task-edit-btn').click()");
        await waitFor(async () => evaluate("document.getElementById('task-form') !== null"), "task edit form");
        assert.equal(await evaluate("document.getElementById('assigned-tasks').textContent"), "1");
        await evaluate("document.getElementById('task-name').value = 'Edited browser task'");
        await evaluate("document.getElementById('task-form').requestSubmit()");
        await waitFor(async () => evaluate("document.querySelector('.saved-task-card h3')?.textContent === 'Edited browser task'"), "edited task title");
        assert.equal(await evaluate("document.getElementById('contribution-percentage').textContent"), "0%");
        console.log("PASS existing task edit flow preserves the assigned count and score");

        await evaluate("document.querySelector('.task-complete-btn').click()");
        await waitFor(async () => evaluate("document.querySelector('.task-status-badge')?.textContent === 'Completed'"), "completed task status");
        assert.equal(await evaluate("document.getElementById('completed-tasks').textContent"), "0");
        assert.equal(await evaluate("document.getElementById('contribution-percentage').textContent"), "0%");
        await evaluate("window.prompt = () => 'https://example.com/task-submission'; document.querySelector('.task-complete-btn').click()");
        await waitFor(async () => evaluate("document.querySelector('.task-verification-badge')?.textContent === 'Awaiting verification'"), "submitted task pending admin verification");
        console.log("PASS completed tasks remain unscored until their submission is verified");

        await send("Page.reload", { ignoreCache: true });
        await new Promise(resolve => setTimeout(resolve, 1200));
        await waitFor(async () => evaluate("document.querySelector('.dashboard-user .user-name')?.textContent === 'Dashboard Browser Test'"), "dashboard after task refresh");
        await waitFor(async () => evaluate("document.getElementById('assigned-tasks').textContent === '1'"), "task persistence after refresh");
        assert.equal(await evaluate("document.getElementById('contribution-percentage').textContent"), "0%");
        await evaluate("document.querySelector('.task-delete-btn').click()");
        await waitFor(async () => evaluate("document.getElementById('assigned-tasks').textContent === '0'"), "recalculated task counts after delete");
        assert.equal(await evaluate("document.getElementById('completed-tasks').textContent"), "0");
        assert.equal(await evaluate("document.getElementById('contribution-percentage').textContent"), "0%");
        assert.equal(await evaluate("document.querySelector('.task-empty-state') !== null"), true);
        console.log("PASS task data and score persist after refresh, recalculate after delete, and handle empty state");

        await evaluate("document.getElementById('add-project-btn').click()");
        await evaluate(`document.getElementById('project-name').value = ${JSON.stringify(projectName)}`);
        await evaluate("document.getElementById('project-description').value = 'Created through the dashboard browser test'");
        await evaluate("document.getElementById('team-name').value = 'Browser Test Team'");
        await evaluate("document.getElementById('project-deadline').value = '2099-01-01'");
        await evaluate("document.getElementById('project-form').requestSubmit()");
        await waitFor(async () => evaluate(
            `document.getElementById('project-feedback')?.textContent.includes('created successfully')`
        ), "project creation through dashboard");
        await waitFor(async () => evaluate(
            `Array.from(document.querySelectorAll('.saved-project-card h3')).some(node => node.textContent === ${JSON.stringify(projectName)})`
        ), "saved project card");
        console.log("PASS dashboard creates and displays a MongoDB-backed project");

        await send("Page.reload", { ignoreCache: true });
        await waitFor(async () => evaluate(
            `Array.from(document.querySelectorAll('.saved-project-card h3')).some(node => node.textContent === ${JSON.stringify(projectName)})`
        ), "project persistence after browser refresh");
        console.log("PASS project remains visible after refreshing the dashboard");

        await evaluate("document.querySelector('.project-edit-btn').click()");
        await evaluate(`document.getElementById('project-name').value = ${JSON.stringify(`${projectName} updated`)}`);
        await evaluate("document.getElementById('project-form').requestSubmit()");
        await waitFor(async () => evaluate(
            `document.getElementById('project-feedback')?.textContent.includes('updated successfully')`
        ), "dashboard project edit");
        console.log("PASS dashboard edits an owned project");

        await evaluate("document.querySelector('.project-delete-btn').click()");
        await waitFor(async () => evaluate(
            `document.getElementById('project-feedback')?.textContent.includes('deleted successfully')`
        ), "dashboard project deletion");
        console.log("PASS dashboard deletes an owned project");

        await evaluate("document.querySelector('.back-home-btn').click()");
        await waitFor(async () => evaluate("location.pathname === '/index.html'"), "dashboard home navigation");
        console.log("PASS dashboard back-home link navigates to index.html");

        const pendingTask = await Task.create({
            title: "Admin browser verification task", description: "Temporary browser verification fixture",
            project: taskProject._id, createdBy: user._id, assignee: user._id,
            deadline: new Date("2099-01-01T00:00:00.000Z"), status: "Completed",
            submissionLink: "https://example.com/admin-browser-test", verificationStatus: "pending"
        });
        await evaluate(`sessionStorage.setItem('teamproofToken', ${JSON.stringify(adminToken)})`);
        await send("Page.navigate", { url: "http://127.0.0.1:5501/admin.html" });
        await waitFor(async () => evaluate("document.querySelector('#verification-table-body button') !== null"), "admin pending task table");
        assert.ok(Number(await evaluate("document.getElementById('admin-student-count').textContent")) >= 1);
        assert.ok(Number(await evaluate("document.getElementById('admin-project-count').textContent")) >= 1);
        assert.ok(Number(await evaluate("document.getElementById('admin-pending-count').textContent")) >= 1);
        assert.equal(await evaluate("document.getElementById('students-table-body').textContent.includes('Dashboard Browser Test')"), true);
        assert.equal(await evaluate(`document.getElementById('projects-table-body').textContent.includes(${JSON.stringify(taskProject.projectName)})`), true);
        await evaluate("Array.from(document.querySelectorAll('#verification-table-body tr')).find(row => row.textContent.includes('Admin browser verification task')).querySelector('.task-complete-btn').click()");
        await waitFor(async () => evaluate("!Array.from(document.querySelectorAll('#verification-table-body tr')).some(row => row.textContent.includes('Admin browser verification task'))"), "admin approval update");
        const verifiedTask = await Task.findById(pendingTask._id);
        assert.equal(verifiedTask.verificationStatus, "approved");
        assert.equal(verifiedTask.verifiedBy.toString(), adminUser._id.toString());
        assert.ok(verifiedTask.verifiedAt);
        console.log("PASS admin dashboard loads real statistics and lists, and records task approval");
        await evaluate(`sessionStorage.setItem('teamproofToken', ${JSON.stringify(token)})`);
        await send("Page.navigate", { url: "http://127.0.0.1:5501/dashboard.html" });
        await waitFor(async () => evaluate("document.getElementById('contribution-percentage')?.textContent === '100%'"), "verified contribution score on student dashboard");
        assert.equal(await evaluate("document.getElementById('completed-tasks').textContent"), "1");
        console.log("PASS an approved MongoDB submission updates the student's dashboard score");
    } finally {
        if (socket && socket.readyState === WebSocket.OPEN) socket.close();
        if (browser && browser.exitCode === null) {
            const browserExit = new Promise(resolve => browser.once("exit", resolve));
            browser.kill();
            await browserExit;
        }
        if (pageServer) await new Promise(resolve => pageServer.close(resolve));
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        if (user) {
            if (taskProject) {
                await Task.deleteMany({ project: taskProject._id });
                await Project.deleteOne({ _id: taskProject._id });
            }
            await Project.deleteOne({
                createdBy: user._id,
                projectName: { $in: [projectName, `${projectName} updated`] }
            });
            await User.deleteOne({ _id: user._id });
        }
        if (adminUser) await User.deleteOne({ _id: adminUser._id });
        if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
            fs.rmSync(profileDir, { recursive: true, force: true });
        }
        await mongoose.disconnect();
    }
}

run().catch(error => {
    console.error(`FAIL dashboard browser checks: ${error.message}`);
    process.exitCode = 1;
    mongoose.disconnect().finally(() => process.exit());
});
