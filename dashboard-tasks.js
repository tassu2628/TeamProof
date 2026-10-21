window.TEAMPROOF_TASKS_API = true;

document.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("task-list");
    const addButton = document.getElementById("add-task-btn");
    if (!list || !addButton) return;

    const apiBase = window.TEAMPROOF_API_BASE_URL || TEAMPROOF_API_BASE;
    let currentUser = null;
    let projects = [];
    let tasks = [];
    let feedback = "";
    let feedbackIsError = false;

    function token() {
        try { return sessionStorage.getItem("teamproofToken"); }
        catch (error) { return null; }
    }

    async function api(path, options = {}) {
        const authToken = token();
        if (!authToken) {
            window.location.replace("login.html");
            throw new Error("Sign in to access your dashboard.");
        }
        let response;
        try {
            response = await fetch(`${apiBase}${path}`, {
                ...options,
                headers: {
                    ...(options.body ? { "Content-Type": "application/json" } : {}),
                    ...(options.headers || {}),
                    Authorization: `Bearer ${authToken}`
                }
            });
        } catch (error) {
            throw new Error("Could not connect to TeamProof. Check that the server is running.");
        }
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
            sessionStorage.removeItem("teamproofToken");
            window.location.replace("login.html");
            throw new Error(data.message || "Your session expired. Please sign in again.");
        }
        if (!response.ok) throw new Error(data.message || "The request could not be completed.");
        return data;
    }

    function setFeedback(message, isError = false) {
        feedback = message;
        feedbackIsError = isError;
        const node = document.getElementById("task-feedback");
        if (node) {
            node.textContent = message;
            node.style.color = isError ? "#C62828" : "#16805D";
        }
    }

    function userId(value) {
        return value && typeof value === "object" ? value._id || value.id : value;
    }

    function renderStats(stats) {
        const assigned = document.getElementById("assigned-tasks");
        const completed = document.getElementById("completed-tasks");
        const scoreText = document.getElementById("contribution-percentage");
        const circle = document.getElementById("progress-circle");
        const summaryText = document.getElementById("summary-percentage");
        const summaryCircle = document.getElementById("summary-circle");
        if (assigned) assigned.textContent = stats.total;
        if (completed) completed.textContent = stats.completed;
        if (scoreText) scoreText.textContent = `${stats.score}%`;
        if (circle) {
            circle.style.setProperty("--progress", `${stats.score}%`);
            circle.setAttribute("aria-valuenow", String(stats.score));
        }
        if (summaryText) summaryText.textContent = `${stats.score}%`;
        if (summaryCircle) summaryCircle.style.setProperty("--summary-progress", `${stats.score}%`);
        const assignedDescription = document.querySelector("#assigned-tasks + .stat-description");
        const completedDescription = document.querySelector("#completed-tasks + .stat-description");
        if (assignedDescription) assignedDescription.textContent = stats.total ? "Tasks assigned to you" : "No tasks assigned";
        if (completedDescription) completedDescription.textContent = stats.completed ? "Verified tasks completed" : "Keep making progress";
    }

    function addText(parent, tag, className, value) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        element.textContent = value;
        parent.appendChild(element);
        return element;
    }

    function renderTasks() {
        list.replaceChildren();
        let legacyTasks = [];
        try {
            const saved = JSON.parse(localStorage.getItem("teamproofTasks") || "[]");
            if (Array.isArray(saved)) legacyTasks = saved;
        } catch (error) { /* Keep old local data untouched. */ }
        if (legacyTasks.length) {
            const notice = addText(list, "p", "legacy-task-notice",
                `${legacyTasks.length} older task(s) remain saved in this browser. They were not imported because project membership and student ownership cannot be verified.`);
        }

        if (!tasks.length) {
            const empty = document.createElement("div");
            empty.className = "task-empty-state";
            addText(empty, "span", "task-check", "✓");
            addText(empty, "h3", "", "No Tasks Yet");
            addText(empty, "p", "", projects.length ? "Start by adding your first task." : "Create or join a project before adding tasks.");
            list.appendChild(empty);
            if (feedback) setFeedback(feedback, feedbackIsError);
            return;
        }

        tasks.forEach(task => {
            const card = document.createElement("article");
            card.className = "saved-task-card";
            addText(card, "h3", "", task.title || "Untitled Task");
            addText(card, "p", "", task.description || "No description provided.");
            addText(card, "p", "", `Project: ${task.project?.projectName || "Project"}`);
            addText(card, "p", "", `Assigned to: ${task.assignee?.name || "Student"}`);
            addText(card, "p", "", `Due date: ${task.deadline ? new Date(task.deadline).toLocaleDateString() : "Not set"}`);
            addText(card, "span", "task-status-badge", task.status);
            const verificationLabel = task.verificationStatus === "approved"
                ? "Verified"
                : task.verificationStatus === "pending"
                    ? "Awaiting verification"
                    : task.verificationStatus === "rejected" ? "Changes requested" : "Not submitted";
            addText(card, "span", "task-status-badge task-verification-badge", verificationLabel);
            if (task.submissionLink) {
                const link = document.createElement("a");
                link.href = task.submissionLink;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = "View submission";
                card.appendChild(link);
            }

            const taskActions = document.createElement("div");
            taskActions.className = "task-actions";
            const isManager = userId(task.createdBy) === currentUser.id || userId(task.project?.createdBy) === currentUser.id;
            const isAssignee = userId(task.assignee) === currentUser.id;
            if (isManager) {
                const edit = document.createElement("button");
                edit.type = "button";
                edit.className = "task-edit-btn";
                edit.textContent = "Edit";
                edit.addEventListener("click", () => openTaskForm(task));
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "task-delete-btn";
                remove.textContent = "Delete";
                remove.addEventListener("click", () => deleteTask(task._id));
                taskActions.append(edit, remove);
            }
            if (isAssignee && task.verificationStatus !== "approved" &&
                (task.status !== "Completed" || task.verificationStatus === "rejected" || task.verificationStatus === "not-submitted")) {
                const complete = document.createElement("button");
                complete.type = "button";
                complete.className = "task-complete-btn";
                complete.textContent = task.status === "Completed" ? "Resubmit for Verification" : "Mark Complete / Submit";
                complete.addEventListener("click", () => submitTask(task));
                taskActions.appendChild(complete);
            }
            if (taskActions.childElementCount) card.appendChild(taskActions);
            list.appendChild(card);
        });
        if (feedback) setFeedback(feedback, feedbackIsError);
    }

    async function refresh() {
        try {
            const [taskResult, statsResult] = await Promise.all([
                api("/tasks"), api("/tasks/stats/contribution")
            ]);
            tasks = taskResult.tasks;
            renderStats(statsResult);
            renderTasks();
        } catch (error) {
            setFeedback(error.message, true);
            renderTasks();
        }
    }

    async function loadProjects() {
        const result = await api("/projects");
        projects = result.projects;
    }

    async function loadProfile() {
        const result = await api("/auth/me");
        currentUser = result.user;
        window.TEAMPROOF_CURRENT_USER = currentUser;
        window.dispatchEvent(new CustomEvent("teamproof:profile-ready", { detail: currentUser }));
        const resultProjects = await api("/projects");
        projects = resultProjects.projects;
        await refresh();
    }

    async function loadMembers(projectId, selectedId = currentUser.id) {
        const result = await api(`/tasks/options?projectId=${encodeURIComponent(projectId)}`);
        const select = document.getElementById("task-assignee");
        select.replaceChildren();
        result.members.forEach(member => {
            const option = document.createElement("option");
            option.value = member.id;
            option.textContent = `${member.name} (${member.email})`;
            select.appendChild(option);
        });
        if (result.members.some(member => member.id === selectedId)) select.value = selectedId;
    }

    function closeModal() {
        const modal = document.getElementById("task-modal");
        if (modal) modal.remove();
        document.body.style.overflow = "";
    }

    async function openTaskForm(task = null) {
        if (document.getElementById("task-modal")) return;
        if (!projects.length) {
            setFeedback("Create or join a project before adding tasks.", true);
            return;
        }
        const modal = document.createElement("div");
        modal.id = "task-modal";
        modal.className = "project-modal";
        modal.innerHTML = `
            <div class="project-modal-content">
                <button type="button" class="modal-close" id="close-task-modal" aria-label="Close">&times;</button>
                <h2>${task ? "Edit Task" : "Add New Task"}</h2>
                <p class="modal-subtitle">Create work for your project and track its verification.</p>
                <form id="task-form" class="task-form-grid">
                    <div class="task-form-field task-form-field-wide"><label for="task-project">Project</label><select id="task-project" required></select></div>
                    <div class="task-form-field"><label for="task-name">Task Name</label><input id="task-name" maxlength="150" required></div>
                    <div class="task-form-field"><label for="task-assignee">Assigned To</label><select id="task-assignee" required></select>
                        <div id="task-add-member" class="task-add-member" hidden>
                            <label for="task-member-email">Add a student to this project</label>
                            <div class="task-member-row"><input id="task-member-email" type="email" placeholder="student@example.com"><button id="task-add-member-button" type="button" class="modal-cancel">Add</button></div>
                        </div>
                    </div>
                    <div class="task-form-field task-form-field-wide"><label for="task-description">Description</label><textarea id="task-description" rows="3" maxlength="2000"></textarea></div>
                    <div class="task-form-field"><label for="task-deadline">Due Date</label><input id="task-deadline" type="date" required></div>
                    <div class="task-form-field"><label for="task-status">Task Status</label><select id="task-status"><option>Pending</option><option>In Progress</option><option>Completed</option></select></div>
                    <div class="task-form-field task-form-field-wide"><label for="task-submission">Submission Link</label><input id="task-submission" type="url" placeholder="https://..." maxlength="2048"></div>
                    <p id="task-modal-feedback" class="form-error task-modal-feedback" role="alert"></p>
                    <div class="task-form-actions"><button type="submit" class="modal-submit">${task ? "Save Changes" : "Save Task"}</button></div>
                </form>
            </div>`;
        document.body.appendChild(modal);
        document.body.style.overflow = "hidden";

        const projectSelect = document.getElementById("task-project");
        projects.forEach(project => {
            const option = document.createElement("option");
            option.value = project._id;
            option.textContent = project.projectName;
            projectSelect.appendChild(option);
        });
        if (task) projectSelect.value = userId(task.project);
        else projectSelect.value = projects[0]._id;
        projectSelect.disabled = Boolean(task);
        document.getElementById("task-name").value = task?.title || "";
        document.getElementById("task-description").value = task?.description || "";
        document.getElementById("task-deadline").value = task?.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : "";
        document.getElementById("task-status").value = task?.status || "Pending";
        document.getElementById("task-submission").value = task?.submissionLink || "";
        document.getElementById("close-task-modal").addEventListener("click", closeModal);
        modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
        projectSelect.addEventListener("change", () => loadMembers(projectSelect.value).catch(error => {
            document.getElementById("task-modal-feedback").textContent = error.message;
        }));
        const memberControls = document.getElementById("task-add-member");
        const updateMemberControls = () => {
            const project = projects.find(item => item._id === projectSelect.value);
            memberControls.hidden = Boolean(task) || userId(project?.createdBy) !== currentUser.id;
        };
        updateMemberControls();
        projectSelect.addEventListener("change", updateMemberControls);
        document.getElementById("task-add-member-button").addEventListener("click", async () => {
            const emailInput = document.getElementById("task-member-email");
            const button = document.getElementById("task-add-member-button");
            if (!emailInput.value.trim()) {
                document.getElementById("task-modal-feedback").textContent = "Enter the student's registered email.";
                return;
            }
            button.disabled = true;
            try {
                const result = await api(`/projects/${projectSelect.value}/members`, {
                    method: "POST", body: JSON.stringify({ email: emailInput.value.trim() })
                });
                await loadMembers(projectSelect.value, result.member.id);
                emailInput.value = "";
                document.getElementById("task-modal-feedback").textContent = result.message;
            } catch (error) {
                document.getElementById("task-modal-feedback").textContent = error.message;
            } finally { button.disabled = false; }
        });
        try {
            await loadMembers(projectSelect.value, task ? userId(task.assignee) : currentUser.id);
        } catch (error) {
            document.getElementById("task-modal-feedback").textContent = error.message;
        }
        document.getElementById("task-form").addEventListener("submit", async event => {
            event.preventDefault();
            const save = event.currentTarget.querySelector("[type='submit']");
            save.disabled = true;
            const payload = {
                title: document.getElementById("task-name").value.trim(),
                description: document.getElementById("task-description").value.trim(),
                assigneeId: document.getElementById("task-assignee").value,
                deadline: document.getElementById("task-deadline").value,
                status: document.getElementById("task-status").value,
                submissionLink: document.getElementById("task-submission").value.trim()
            };
            try {
                if (task) await api(`/tasks/${task._id}`, { method: "PUT", body: JSON.stringify(payload) });
                else await api("/tasks", { method: "POST", body: JSON.stringify({ ...payload, projectId: projectSelect.value }) });
                closeModal();
                setFeedback(task ? "Task updated successfully." : "Task created successfully.");
                await refresh();
            } catch (error) {
                document.getElementById("task-modal-feedback").textContent = error.message;
                save.disabled = false;
            }
        });
    }

    async function submitTask(task) {
        const submissionLink = window.prompt("Add a URL for your work (leave blank if there is no link):", task.submissionLink || "");
        if (submissionLink === null) return;
        try {
            await api(`/tasks/${task._id}`, { method: "PUT", body: JSON.stringify({ status: "Completed", submissionLink: submissionLink.trim() }) });
            setFeedback(submissionLink.trim() ? "Task submitted for verification." : "Task marked complete. Add a submission link to request verification.");
            await refresh();
        } catch (error) { setFeedback(error.message, true); }
    }

    async function deleteTask(id) {
        if (!window.confirm("Delete this task? This cannot be undone.")) return;
        try {
            await api(`/tasks/${id}`, { method: "DELETE" });
            setFeedback("Task deleted successfully.");
            await refresh();
        } catch (error) { setFeedback(error.message, true); }
    }

    list.textContent = "Loading your tasks…";
    addButton.addEventListener("click", () => openTaskForm());
    loadProfile().catch(error => setFeedback(error.message, true));
});
