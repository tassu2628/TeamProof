// MongoDB-backed project management for the existing student dashboard.
window.TEAMPROOF_PROJECTS_API = true;

document.addEventListener("DOMContentLoaded", () => {
    const projectsContainer = document.getElementById("empty-projects");
    const addProjectButton = document.getElementById("add-project-btn");
    const feedback = document.getElementById("project-feedback");
    const legacyNotice = document.getElementById("legacy-projects-notice");

    if (!projectsContainer || !addProjectButton) return;

    let projects = [];
    let currentUser = null;
    let editingProjectId = null;

    function setFeedback(message, isError = false) {
        if (!feedback) return;
        feedback.textContent = message;
        feedback.style.color = isError ? "#D9534F" : "#16805D";
    }

    // Preserve old browser-only records and explain why they are not imported.
    try {
        const oldProjects = JSON.parse(localStorage.getItem("teamproofProjects") || "[]");
        if (Array.isArray(oldProjects) && oldProjects.length && legacyNotice) {
            legacyNotice.textContent =
                `${oldProjects.length} older project(s) remain saved in this browser. ` +
                "They were not imported because their account owner cannot be verified.";
            legacyNotice.hidden = false;
        }
    } catch (error) {
        // Keep legacy data unchanged, even if it cannot be parsed.
    }

    async function apiRequest(endpoint, options = {}) {
        let token;
        try {
            token = sessionStorage.getItem("teamproofToken");
        } catch (error) {
            token = null;
        }

        if (!token) {
            window.location.replace("login.html");
            throw new Error("Sign in to access your dashboard.");
        }

        let response;
        try {
            response = await fetch(`${TEAMPROOF_API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    ...(options.body ? { "Content-Type": "application/json" } : {}),
                    ...(options.headers || {}),
                    Authorization: `Bearer ${token}`
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
        if (!response.ok) {
            throw new Error(data.message || "The request could not be completed.");
        }
        return data;
    }

    function recordActivity(action, projectName) {
        let activities = [];
        try {
            const savedActivities = JSON.parse(localStorage.getItem("teamproofActivities") || "[]");
            if (Array.isArray(savedActivities)) activities = savedActivities;
        } catch (error) {
            activities = [];
        }

        activities.unshift({
            id: Date.now(),
            action,
            projectName,
            time: new Date().toISOString()
        });
        activities = activities.slice(0, 20);

        try {
            localStorage.setItem("teamproofActivities", JSON.stringify(activities));
        } catch (error) {
            console.error("Could not save activity:", error);
        }

        renderActivities(activities);
    }

    function renderActivities(activities) {
        const activityList = document.getElementById("activity-list");
        if (!activityList) return;
        activityList.replaceChildren();

        if (activities.length === 0) {
            const empty = document.createElement("div");
            empty.className = "activity-empty";
            const text = document.createElement("p");
            text.textContent = "No recent activity to display.";
            const hint = document.createElement("span");
            hint.textContent = "Your project activity will appear here.";
            empty.append(text, hint);
            activityList.appendChild(empty);
            return;
        }

        activities.forEach(activity => {
            const item = document.createElement("div");
            item.className = "activity-item";
            const dot = document.createElement("div");
            dot.className = "activity-dot";
            dot.textContent = activity.action === "Created" ? "+" : activity.action === "Updated" ? "↻" : "−";
            const content = document.createElement("div");
            content.className = "activity-item-content";
            const title = document.createElement("h3");
            title.textContent = `Project ${activity.action}`;
            const name = document.createElement("p");
            name.textContent = activity.projectName;
            const time = document.createElement("span");
            time.className = "activity-time";
            const date = new Date(activity.time);
            time.textContent = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
            content.append(title, name, time);
            item.append(dot, content);
            activityList.appendChild(item);
        });
    }

    function showLoadError(message) {
        projectsContainer.replaceChildren();
        const text = document.createElement("p");
        text.className = "project-load-error";
        text.textContent = message;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "primary-btn";
        retry.textContent = "Try Again";
        retry.addEventListener("click", () => loadProjects());
        projectsContainer.append(text, retry);
    }

    function renderProjects() {
        projectsContainer.replaceChildren();
        const count = document.getElementById("total-projects");
        if (count) count.textContent = String(projects.length);

        if (projects.length === 0) {
            projectsContainer.innerHTML = `
                <div class="empty-icon">
                    <svg viewBox="0 0 64 64" aria-hidden="true">
                        <path d="M8 17a5 5 0 0 1 5-5h14l6 7h18a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z"/>
                        <path d="M8 27h48"/>
                    </svg>
                </div>
                <h3>No Projects Yet</h3>
                <p>Your projects will appear here when you add one. Start your journey with TeamProof!</p>
                <button type="button" class="primary-btn" id="first-project-btn">
                    <span>+</span> Create Your First Project
                </button>`;
            document.getElementById("first-project-btn").addEventListener("click", () => openProjectForm());
            return;
        }

        projects.forEach(project => {
            const card = document.createElement("article");
            card.className = "saved-project-card";
            const heading = document.createElement("h3");
            heading.textContent = project.projectName;
            const description = document.createElement("p");
            description.textContent = project.description;
            const team = document.createElement("p");
            team.textContent = `Team: ${project.teamName}`;
            const deadline = document.createElement("p");
            deadline.textContent = `Deadline: ${new Date(project.deadline).toLocaleDateString()}`;
            const badge = document.createElement("span");
            badge.className = "project-status";
            badge.textContent = project.status;
            card.append(heading, description, team, deadline, badge);

            // Members may view a shared project; only its creator can change it.
            if (project.createdBy === currentUser.id) {
                const actions = document.createElement("div");
                actions.className = "project-actions";
                const edit = document.createElement("button");
                edit.type = "button";
                edit.className = "project-edit-btn";
                edit.textContent = "✏️ Edit";
                edit.addEventListener("click", () => openProjectForm(project));
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "project-delete-btn";
                remove.textContent = "🗑️ Delete";
                remove.addEventListener("click", () => deleteProject(project._id));
                actions.append(edit, remove);
                card.appendChild(actions);
            }
            projectsContainer.appendChild(card);
        });
    }

    async function loadProjects({ showLoading = true } = {}) {
        if (showLoading) {
            projectsContainer.textContent = "Loading your projects…";
            setFeedback("");
        }
        try {
            const result = await apiRequest("/projects");
            projects = result.projects;
            renderProjects();
            return true;
        } catch (error) {
            showLoadError(error.message);
            return false;
        }
    }

    function closeProjectForm() {
        const modal = document.getElementById("project-modal");
        if (modal) modal.remove();
        document.body.style.overflow = "";
        document.removeEventListener("keydown", handleEscape);
        editingProjectId = null;
    }

    function handleEscape(event) {
        if (event.key === "Escape") closeProjectForm();
    }

    function openProjectForm(project = null) {
        if (document.getElementById("project-modal")) return;
        editingProjectId = project ? project._id : null;

        const modal = document.createElement("div");
        modal.id = "project-modal";
        modal.className = "project-modal";
        modal.innerHTML = `
            <div class="project-modal-content">
                <div class="modal-heading">
                    <div>
                        <p class="modal-label">TEAMPROOF WORKSPACE</p>
                        <h2>${project ? "Edit Project" : "Create New Project"}</h2>
                        <p>Manage your project details.</p>
                    </div>
                    <button type="button" class="modal-close" id="close-project-modal" aria-label="Close">&times;</button>
                </div>
                <form id="project-form">
                    <label for="project-name">Project Name *</label>
                    <input type="text" id="project-name" maxlength="100" placeholder="e.g. TeamProof Website" required>
                    <label for="project-description">Project Description *</label>
                    <textarea id="project-description" rows="4" maxlength="1000" placeholder="Describe your project..." required></textarea>
                    <label for="team-name">Team Name *</label>
                    <input type="text" id="team-name" maxlength="100" placeholder="e.g. Future Developers" required>
                    <label for="project-deadline">Deadline *</label>
                    <input type="date" id="project-deadline" required>
                    <p class="form-error" id="project-error" role="alert"></p>
                    <div class="modal-actions">
                        <button type="button" class="modal-cancel" id="cancel-project">Cancel</button>
                        <button type="submit" class="primary-btn">${project ? "Save Changes" : "Create Project"}</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(modal);
        document.body.style.overflow = "hidden";
        const deadline = document.getElementById("project-deadline");
        const today = new Date();
        deadline.min = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");

        if (project) {
            document.getElementById("project-name").value = project.projectName;
            document.getElementById("project-description").value = project.description;
            document.getElementById("team-name").value = project.teamName;
            deadline.value = new Date(project.deadline).toISOString().slice(0, 10);
        }

        document.getElementById("project-name").focus();
        document.getElementById("close-project-modal").addEventListener("click", closeProjectForm);
        document.getElementById("cancel-project").addEventListener("click", closeProjectForm);
        modal.addEventListener("click", event => {
            if (event.target === modal) closeProjectForm();
        });
        document.addEventListener("keydown", handleEscape);
        document.getElementById("project-form").addEventListener("submit", saveProject);
    }

    async function saveProject(event) {
        event.preventDefault();
        const name = document.getElementById("project-name").value.trim();
        const description = document.getElementById("project-description").value.trim();
        const teamName = document.getElementById("team-name").value.trim();
        const deadline = document.getElementById("project-deadline").value;
        const error = document.getElementById("project-error");

        if (!name || !description || !teamName || !deadline) {
            error.textContent = "Please fill in all required fields.";
            return;
        }
        if (new Date(`${deadline}T00:00:00`) < new Date(new Date().setHours(0, 0, 0, 0))) {
            error.textContent = "Please select today or a future deadline.";
            return;
        }

        const submit = document.querySelector("#project-form [type='submit']");
        const label = submit.textContent;
        const isEditing = Boolean(editingProjectId);
        submit.disabled = true;
        submit.textContent = "Saving…";
        error.textContent = "";

        try {
            await apiRequest(isEditing ? `/projects/${editingProjectId}` : "/projects", {
                method: isEditing ? "PUT" : "POST",
                body: JSON.stringify({ projectName: name, description, teamName, deadline })
            });
            closeProjectForm();
            await loadProjects({ showLoading: false });
            recordActivity(isEditing ? "Updated" : "Created", name);
            setFeedback(`Project ${isEditing ? "updated" : "created"} successfully.`);
        } catch (requestError) {
            error.textContent = requestError.message;
        } finally {
            if (submit.isConnected) {
                submit.disabled = false;
                submit.textContent = label;
            }
        }
    }

    async function deleteProject(projectId) {
        const project = projects.find(item => item._id === projectId);
        if (!project || !confirm(`Are you sure you want to delete "${project.projectName}"?`)) return;
        try {
            await apiRequest(`/projects/${projectId}`, { method: "DELETE" });
            await loadProjects({ showLoading: false });
            recordActivity("Deleted", project.projectName);
            setFeedback("Project deleted successfully.");
        } catch (error) {
            setFeedback(error.message, true);
        }
    }

    addProjectButton.addEventListener("click", () => openProjectForm());

    async function loadDashboard() {
        try {
            const result = await apiRequest("/auth/me");
            currentUser = result.user;
            window.TEAMPROOF_CURRENT_USER = currentUser;
            window.dispatchEvent(new CustomEvent("teamproof:profile-ready", { detail: currentUser }));
            const nameLabel = document.querySelector(".dashboard-user .user-name");
            const avatar = document.querySelector(".dashboard-user .user-avatar");
            const welcome = document.querySelector(".welcome-content h1");
            if (nameLabel) nameLabel.textContent = currentUser.name;
            if (avatar) avatar.textContent = currentUser.name.charAt(0).toUpperCase();
            if (welcome) welcome.textContent = `Welcome Back, ${currentUser.name}!`;

            let activities = [];
            try {
                const saved = JSON.parse(localStorage.getItem("teamproofActivities") || "[]");
                if (Array.isArray(saved)) activities = saved;
            } catch (error) {
                activities = [];
            }
            renderActivities(activities);
            await loadProjects();
        } catch (error) {
            showLoadError(error.message);
        }
    }

    loadDashboard();
});
