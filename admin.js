document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".admin-nav a[href^='#']").forEach(link => {
        link.addEventListener("click", event => {
            const target = document.querySelector(link.getAttribute("href"));
            if (!target) return;
            event.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });

    loadAdminDashboard();
});

async function adminRequest(path, options = {}) {
    let token;
    try { token = sessionStorage.getItem("teamproofToken"); }
    catch (error) { token = null; }
    if (!token) {
        window.location.replace("login.html");
        throw new Error("Sign in with an administrator account to continue.");
    }
    let response;
    try {
        const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
        const apiBase = window.TEAMPROOF_API_BASE_URL ||
            (localDevelopmentHost && window.location.port !== "5000"
                ? "http://localhost:5000/api"
                : `${window.location.origin}/api`);
        response = await fetch(`${apiBase}/admin${path}`, {
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                Authorization: `Bearer ${token}`,
                ...(options.headers || {})
            }
        });
    } catch (error) {
        throw new Error("Could not connect to TeamProof. Check that the server is running.");
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
        sessionStorage.removeItem("teamproofToken");
        window.location.replace("login.html");
        throw new Error("Your session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.message || "The request could not be completed.");
    return data;
}

function setAdminFeedback(message, isError = false) {
    const target = document.getElementById("admin-feedback");
    if (!target) return;
    target.textContent = message;
    target.style.color = isError ? "#C62828" : "#16805D";
}

function tableMessage(body, columns, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns;
    cell.textContent = message;
    row.appendChild(cell);
    body.replaceChildren(row);
}

function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value || "—";
    row.appendChild(cell);
    return cell;
}

async function loadAdminDashboard() {
    try {
        const [statsResult, studentsResult, projectsResult, tasksResult] = await Promise.all([
            adminRequest("/stats"), adminRequest("/students"),
            adminRequest("/projects"), adminRequest("/tasks/pending")
        ]);
        const stats = statsResult.stats;
        document.getElementById("admin-student-count").textContent = stats.students;
        document.getElementById("admin-project-count").textContent = stats.projects;
        document.getElementById("admin-task-count").textContent = stats.tasks;
        document.getElementById("admin-pending-count").textContent = stats.pendingVerification;
        renderStudents(studentsResult.students);
        renderProjects(projectsResult.projects);
        renderPendingTasks(tasksResult.tasks);
        setAdminFeedback(`Signed in as administrator. Loaded ${stats.students} students, ${stats.projects} projects, and ${tasksResult.tasks.length} pending submissions.`);
    } catch (error) {
        setAdminFeedback(error.message, true);
        if (/permission|administrator/i.test(error.message)) {
            document.querySelector(".admin-welcome p").textContent = "Your account does not have administrator access.";
        }
    }
}

function renderStudents(students) {
    const body = document.getElementById("students-table-body");
    if (!students.length) return tableMessage(body, 5, "No students registered yet.");
    body.replaceChildren();
    students.forEach((student, index) => {
        const row = document.createElement("tr");
        addCell(row, String(index + 1));
        addCell(row, student.name);
        addCell(row, student.email);
        addCell(row, student.role);
        addCell(row, "Active");
        body.appendChild(row);
    });
}

function renderProjects(projects) {
    const body = document.getElementById("projects-table-body");
    if (!projects.length) return tableMessage(body, 5, "No projects available yet.");
    body.replaceChildren();
    projects.forEach((project, index) => {
        const row = document.createElement("tr");
        addCell(row, String(index + 1));
        addCell(row, project.projectName);
        addCell(row, project.createdBy?.name || "Unknown");
        addCell(row, project.deadline ? new Date(project.deadline).toLocaleDateString() : "—");
        addCell(row, project.status);
        body.appendChild(row);
    });
}

function renderPendingTasks(tasks) {
    const body = document.getElementById("verification-table-body");
    if (!tasks.length) return tableMessage(body, 6, "No submissions pending verification.");
    body.replaceChildren();
    tasks.forEach((task, index) => {
        const row = document.createElement("tr");
        addCell(row, String(index + 1));
        addCell(row, task.assignee?.name || "Unknown");
        addCell(row, `${task.title} (${task.project?.projectName || "Project"})`);
        const submission = document.createElement("td");
        if (task.submissionLink) {
            const link = document.createElement("a");
            link.href = task.submissionLink;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "View submission";
            submission.appendChild(link);
        } else submission.textContent = "No link provided";
        row.appendChild(submission);
        addCell(row, "Pending");
        const actions = document.createElement("td");
        ["approve", "reject"].forEach(decision => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = decision === "approve" ? "task-complete-btn" : "task-delete-btn";
            button.textContent = decision === "approve" ? "Approve" : "Reject";
            button.addEventListener("click", () => verifyTask(task._id, decision, button));
            actions.appendChild(button);
        });
        row.appendChild(actions);
        body.appendChild(row);
    });
}

async function verifyTask(taskId, decision, button) {
    const row = button.closest("tr");
    row.querySelectorAll("button").forEach(item => { item.disabled = true; });
    try {
        const result = await adminRequest(`/tasks/${encodeURIComponent(taskId)}/verification`, {
            method: "PUT",
            body: JSON.stringify({ decision })
        });
        setAdminFeedback(result.message);
        await loadAdminDashboard();
    } catch (error) {
        row.querySelectorAll("button").forEach(item => { item.disabled = false; });
        setAdminFeedback(error.message, true);
    }
}
