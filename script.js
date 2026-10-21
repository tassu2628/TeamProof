// TeamProof Mobile Menu

const menuToggle = document.getElementById("menu-toggle");
const navLinks = document.getElementById("nav-links");

if (menuToggle && navLinks) {
    menuToggle.addEventListener("click", function () {
        navLinks.classList.toggle("show");

        const isOpen = navLinks.classList.contains("show");

        menuToggle.setAttribute("aria-expanded", isOpen);
        menuToggle.textContent = isOpen ? "✕" : "☰";
    });
}

// Keep authentication tokens in tab-scoped sessionStorage, never localStorage.
// This limits persistence; like other browser storage, it is readable by page JS.
const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
const TEAMPROOF_API_BASE = (window.TEAMPROOF_API_BASE_URL ||
    (localDevelopmentHost && window.location.port !== "5000"
        ? "http://localhost:5000/api"
        : `${window.location.origin}/api`)).replace(/\/+$/, "");
window.TEAMPROOF_API_BASE_URL = TEAMPROOF_API_BASE;

function showAuthMessage(element, text, isError = true) {
    if (!element) return;
    element.textContent = text;
    element.style.color = isError ? "#D9534F" : "#008C95";
}

// TeamProof Signup Form

document.addEventListener("DOMContentLoaded", function () {
    const signupForm = document.getElementById("signup-form");

    if (!signupForm) return;

    signupForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const nameInput = signupForm.querySelector(
            'input[name="name"], #full-name, #signup-name'
        );

        const emailInput = signupForm.querySelector(
            'input[name="email"], #email, #signup-email'
        );

        const passwordInput = signupForm.querySelector(
            'input[name="password"], #signup-password'
        );

        const confirmInput = signupForm.querySelector(
            'input[name="confirmPassword"], #confirm-password'
        );

        const message = document.getElementById("password-message");

        if (!passwordInput || !confirmInput) {
            showAuthMessage(message, "Signup form is incomplete. Please refresh and try again.");
            return;
        }

        if (passwordInput.value.length < 8) {
            showAuthMessage(message, "Password must be at least 8 characters long.");
            return;
        }

        if (passwordInput.value !== confirmInput.value) {
            showAuthMessage(message, "Password and Confirm Password do not match.");
            confirmInput.focus();
            return;
        }

        if (!nameInput || !emailInput ||
            !nameInput.value.trim() || !emailInput.value.trim()) {
            showAuthMessage(message, "Please fill in all required fields.");
            return;
        }

        const roleInput = signupForm.querySelector('[name="role"]');
        const submitButton = signupForm.querySelector('[type="submit"]');
        const originalButtonText = submitButton ? submitButton.textContent : "";

        showAuthMessage(message, "Creating your account…", false);
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Creating account…";
        }

        fetch(`${TEAMPROOF_API_BASE}/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: nameInput.value.trim(),
                email: emailInput.value.trim(),
                password: passwordInput.value,
                role: roleInput ? roleInput.value : ""
            })
        })
            .then(async response => ({
                response,
                data: await response.json().catch(() => ({}))
            }))
            .then(({ response, data }) => {
                if (!response.ok) {
                    throw new Error(data.message || "Unable to create your account.");
                }

                // Tab-scoped storage clears when this browser tab is closed.
                sessionStorage.setItem("teamproofToken", data.token);
                const destination = data.user && data.user.role === "admin"
                    ? "admin.html"
                    : "dashboard.html";
                showAuthMessage(message, "Account created. Opening your dashboard…", false);
                window.setTimeout(() => {
                    window.location.href = destination;
                }, 600);
            })
            .catch(error => {
                showAuthMessage(
                    message,
                    error instanceof TypeError
                        ? "Could not connect to TeamProof. Please try again."
                        : error.message
                );
            })
            .finally(() => {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = originalButtonText;
                }
            });
    });
});
// Password Show / Hide Feature

const passwordButtons = document.querySelectorAll(".password-toggle");

passwordButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        const targetId = button.getAttribute("data-target");
        const passwordInput = document.getElementById(targetId);

        if (!passwordInput) return;

        if (passwordInput.type === "password") {
            passwordInput.type = "text";
            button.textContent = "Hide";
        } else {
            passwordInput.type = "password";
            button.textContent = "Show";
        }
    });
});

// Password Strength Indicator

const passwordField = document.getElementById("signup-password");
const strengthBar = document.getElementById("strength-bar");
const strengthText = document.getElementById("strength-text");

if (passwordField && strengthBar && strengthText) {
    passwordField.addEventListener("input", function () {
        const password = passwordField.value;
        let score = 0;

        if (password.length >= 8) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        if (password.length === 0) {
            strengthBar.style.width = "0";
            strengthText.textContent = "Password strength";
        } else if (score <= 2) {
            strengthBar.style.width = "33%";
            strengthBar.style.backgroundColor = "#D9534F";
            strengthText.textContent = "Weak Password";
        } else if (score <= 4) {
            strengthBar.style.width = "66%";
            strengthBar.style.backgroundColor = "#E6A23C";
            strengthText.textContent = "Medium Password";
        } else {
            strengthBar.style.width = "100%";
            strengthBar.style.backgroundColor = "#16805D";
            strengthText.textContent = "Strong Password";
        }
    });
}

// TeamProof Login Form

const loginForm = document.getElementById("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        const message = document.getElementById("login-message");

        if (email === "" || password === "") {
            showAuthMessage(message, "Please fill in all fields.");
            return;
        }

        const submitButton = loginForm.querySelector('[type="submit"]');
        const originalButtonText = submitButton ? submitButton.textContent : "";
        showAuthMessage(message, "Signing in…", false);

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Signing in…";
        }

        fetch(`${TEAMPROOF_API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        })
            .then(async response => ({
                response,
                data: await response.json().catch(() => ({}))
            }))
            .then(({ response, data }) => {
                if (!response.ok) {
                    throw new Error(data.message || "Unable to sign in.");
                }

                // Tab-scoped storage clears when this browser tab is closed.
                sessionStorage.setItem("teamproofToken", data.token);
                showAuthMessage(message, "Signed in. Opening your dashboard…", false);
                window.setTimeout(() => {
                    window.location.href = "dashboard.html";
                }, 600);
            })
            .catch(error => {
                showAuthMessage(
                    message,
                    error instanceof TypeError
                        ? "Could not connect to TeamProof. Please try again."
                        : error.message
                );
            })
            .finally(() => {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = originalButtonText;
                }
            });
    });
}

// TeamProof Forgot Password Form

const forgotForm = document.getElementById("forgot-form");

if (forgotForm) {
    forgotForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const email = document.getElementById("forgot-email").value.trim();
        const message = document.getElementById("forgot-message");

        if (email === "") {
            message.textContent = "Please enter your email address.";
            message.style.color = "red";
        } else {
            message.textContent =
                "Form submitted! Password recovery will be available after backend integration.";

            message.style.color = "#008C95";
        }
    });
}

/* =====================================
   TEAMPROOF - DASHBOARD PROJECTS
===================================== */

document.addEventListener("DOMContentLoaded", function () {
    // dashboard-projects.js sets this before DOMContentLoaded on the dashboard.
    if (window.TEAMPROOF_PROJECTS_API) return;

    const projectsContainer = document.getElementById("empty-projects");
    const addProjectBtn = document.getElementById("add-project-btn");
    const firstProjectBtn = document.getElementById("first-project-btn");

    if (!projectsContainer || !addProjectBtn || !firstProjectBtn) {
        return;
    }

    let projects = [];

    try {
        projects = JSON.parse(
            localStorage.getItem("teamproofProjects") || "[]"
        );

        if (!Array.isArray(projects)) {
            projects = [];
        }
    } catch (error) {
        projects = [];
    }

    let editingProjectId = null;

    // Recent Activity Storage

    let activities = [];

    try {
        activities = JSON.parse(
            localStorage.getItem("teamproofActivities") || "[]"
        );

        if (!Array.isArray(activities)) {
            activities = [];
        }
    } catch (error) {
        activities = [];
    }

    // Record a new activity

    function recordActivity(action, projectName) {
        const activity = {
            id: Date.now(),
            action: action,
            projectName: projectName,
            time: new Date().toISOString()
        };

        activities.unshift(activity);
        activities = activities.slice(0, 20);

        try {
            localStorage.setItem(
                "teamproofActivities",
                JSON.stringify(activities)
            );
        } catch (error) {
            console.error("Could not save activity:", error);
        }

        renderActivities();
    }

    // Display activities

    function renderActivities() {
        const activityList = document.getElementById("activity-list");

        if (!activityList) return;

        activityList.innerHTML = "";

        if (activities.length === 0) {
            activityList.innerHTML = `
                <div class="activity-empty">
                    <p>No recent activity to display.</p>
                    <span>Your project activity will appear here.</span>
                </div>
            `;
            return;
        }

        activities.forEach(function (activity) {
            const item = document.createElement("div");
            item.className = "activity-item";

            const icon = document.createElement("div");
            icon.className = "activity-dot";
            icon.textContent =
                activity.action === "Created" ? "+" :
                activity.action === "Updated" ? "↻" : "−";

            const content = document.createElement("div");
            content.className = "activity-item-content";

            const title = document.createElement("h3");
            title.textContent = "Project " + activity.action;

            const description = document.createElement("p");
            description.textContent = activity.projectName;

            const time = document.createElement("span");
            time.className = "activity-time";

            const date = new Date(activity.time);

            time.textContent = isNaN(date.getTime())
                ? ""
                : date.toLocaleString();

            content.append(title, description, time);
            item.append(icon, content);

            activityList.appendChild(item);
        });
    }

    // Save projects to browser storage

    function saveProjects() {
        try {
            localStorage.setItem(
                "teamproofProjects",
                JSON.stringify(projects)
            );

            return true;
        } catch (error) {
            alert("Unable to save projects. Browser storage may be full.");
            return false;
        }
    }

    // Open Add/Edit Project Form

    function openProjectForm(project = null) {
        if (document.getElementById("project-modal")) return;

        editingProjectId = project ? project.id : null;

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

                    <button type="button"
                        class="modal-close"
                        id="close-project-modal"
                        aria-label="Close">&times;</button>
                </div>

                <form id="project-form">

                    <label for="project-name">Project Name *</label>
                    <input type="text"
                        id="project-name"
                        maxlength="100"
                        placeholder="e.g. TeamProof Website"
                        required>

                    <label for="project-description">Project Description *</label>
                    <textarea id="project-description"
                        rows="4"
                        maxlength="1000"
                        placeholder="Describe your project..."
                        required></textarea>

                    <label for="team-name">Team Name *</label>
                    <input type="text"
                        id="team-name"
                        maxlength="100"
                        placeholder="e.g. Future Developers"
                        required>

                    <label for="project-deadline">Deadline *</label>
                    <input type="date"
                        id="project-deadline"
                        required>

                    <p class="form-error" id="project-error"></p>

                    <div class="modal-actions">
                        <button type="button"
                            class="modal-cancel"
                            id="cancel-project">Cancel</button>

                        <button type="submit" class="primary-btn">
                            ${project ? "Save Changes" : "Create Project"}
                        </button>
                    </div>

                </form>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.style.overflow = "hidden";

        const dateInput = document.getElementById("project-deadline");
        const today = new Date();

        const localToday = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");

        dateInput.min = localToday;

        if (project) {
            document.getElementById("project-name").value = project.name;
            document.getElementById("project-description").value = project.description;
            document.getElementById("team-name").value = project.team;
            dateInput.value = project.deadline;
        }

        document.getElementById("project-name").focus();

        document.getElementById("close-project-modal")
            .addEventListener("click", closeProjectForm);

        document.getElementById("cancel-project")
            .addEventListener("click", closeProjectForm);

        modal.addEventListener("click", function (event) {
            if (event.target === modal) {
                closeProjectForm();
            }
        });

        document.addEventListener("keydown", handleEscape);

        document.getElementById("project-form")
            .addEventListener("submit", saveProject);
    }
        // Close Project Form

    function closeProjectForm() {
        const modal = document.getElementById("project-modal");

        if (modal) {
            modal.remove();
        }

        document.body.style.overflow = "";
        document.removeEventListener("keydown", handleEscape);
        editingProjectId = null;
    }

    function handleEscape(event) {
        if (event.key === "Escape") {
            closeProjectForm();
        }
    }

    // Add or Update Project

    function saveProject(event) {
        event.preventDefault();

        const name = document.getElementById("project-name").value.trim();
        const description = document.getElementById("project-description").value.trim();
        const team = document.getElementById("team-name").value.trim();
        const deadline = document.getElementById("project-deadline").value;
        const error = document.getElementById("project-error");

        if (!name || !description || !team || !deadline) {
            error.textContent = "Please fill in all required fields.";
            return;
        }

        const selectedDate = new Date(deadline + "T00:00:00");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (selectedDate < today) {
            error.textContent = "Please select today or a future deadline.";
            return;
        }

        let action;

        if (editingProjectId !== null) {
            const projectIndex = projects.findIndex(
                project => project.id === editingProjectId
            );

            if (projectIndex === -1) {
                error.textContent = "Project not found. Please refresh the page.";
                return;
            }

            const oldProject = { ...projects[projectIndex] };

            projects[projectIndex] = {
                ...projects[projectIndex],
                name,
                description,
                team,
                deadline,
                updatedAt: new Date().toISOString()
            };

            if (!saveProjects()) {
                projects[projectIndex] = oldProject;
                return;
            }

            action = "Updated";
        } else {
            const newProject = {
                id: Date.now(),
                name,
                description,
                team,
                deadline,
                createdAt: new Date().toISOString()
            };

            projects.push(newProject);

            if (!saveProjects()) {
                projects.pop();
                return;
            }

            action = "Created";
        }

        closeProjectForm();
        renderProjects();
        recordActivity(action, name);
    }

    // Delete Project

    function deleteProject(projectId) {
        const project = projects.find(item => item.id === projectId);

        if (!project) return;

        const confirmed = confirm(
            `Are you sure you want to delete "${project.name}"?`
        );

        if (!confirmed) return;

        const previousProjects = [...projects];
        const deletedProjectName = project.name;

        projects = projects.filter(item => item.id !== projectId);

        if (!saveProjects()) {
            projects = previousProjects;
            return;
        }

        renderProjects();
        recordActivity("Deleted", deletedProjectName);
    }

    // Display Projects

    function renderProjects() {
        projectsContainer.innerHTML = "";

        const totalProjects = document.getElementById("total-projects");

        if (totalProjects) {
            totalProjects.textContent = projects.length;
        }

        if (projects.length === 0) {
            projectsContainer.innerHTML = `
                <div class="empty-icon">
                    <svg viewBox="0 0 64 64" aria-hidden="true">
                        <path d="M8 17a5 5 0 0 1 5-5h14l6 7h18a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z"/>
                        <path d="M8 27h48"/>
                    </svg>
                </div>

                <h3>No Projects Yet</h3>

                <p>Your projects will appear here when you add one.
                Start your journey with TeamProof!</p>

                <button type="button"
                    class="primary-btn"
                    id="first-project-btn">
                    <span>+</span> Create Your First Project
                </button>
            `;

            document.getElementById("first-project-btn")
                .addEventListener("click", function () {
                    openProjectForm();
                });

            return;
        }

        projects.forEach(function (project) {
            const card = document.createElement("article");
            card.className = "saved-project-card";

            const heading = document.createElement("h3");
            heading.textContent = project.name;

            const description = document.createElement("p");
            description.textContent = project.description;

            const team = document.createElement("p");
            team.textContent = "Team: " + project.team;

            const deadline = document.createElement("p");
            deadline.textContent = "Deadline: " + project.deadline;

            const badge = document.createElement("span");
            badge.className = "project-status";
            badge.textContent = "Created";

            const actions = document.createElement("div");
            actions.className = "project-actions";

            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "project-edit-btn";
            editButton.textContent = "✏️ Edit";

            editButton.addEventListener("click", function () {
                openProjectForm(project);
            });

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "project-delete-btn";
            deleteButton.textContent = "🗑️ Delete";

            deleteButton.addEventListener("click", function () {
                deleteProject(project.id);
            });

            actions.append(editButton, deleteButton);
            card.append(
                heading,
                description,
                team,
                deadline,
                badge,
                actions
            );

            projectsContainer.appendChild(card);
        });
    }

    // Main Project Buttons

    addProjectBtn.addEventListener("click", function () {
        openProjectForm();
    });

    // Load Projects and Activities

    renderProjects();
    renderActivities();
});
/* =====================================
   TEAMPROOF - TASK MANAGEMENT
===================================== */

document.addEventListener("DOMContentLoaded", function () {
    if (window.TEAMPROOF_TASKS_API) return;
    const addTaskBtn = document.getElementById("add-task-btn");
    const taskList = document.getElementById("task-list");

    if (!addTaskBtn || !taskList) return;

    let tasks = [];
    let currentTaskUser = window.TEAMPROOF_CURRENT_USER || null;

    try {
        const savedTasks = JSON.parse(
            localStorage.getItem("teamproofTasks") || "[]"
        );

        tasks = Array.isArray(savedTasks) ? savedTasks : [];
    } catch (error) {
        console.error("Could not load tasks:", error);
    }

    // Save Tasks

    function saveTasks() {
        try {
            localStorage.setItem(
                "teamproofTasks",
                JSON.stringify(tasks)
            );
            return true;
        } catch (error) {
            alert("Unable to save tasks. Please try again.");
            console.error(error);
            return false;
        }
    }

    // Render Tasks

    function renderTasks() {
        taskList.innerHTML = "";

        const assignedTasks = currentTaskUser && currentTaskUser.name
            ? tasks.filter(task =>
                String(task.assignee || "").trim().toLocaleLowerCase() ===
                String(currentTaskUser.name).trim().toLocaleLowerCase()
            )
            : [];
        const completedTasks = assignedTasks.filter(task => task.status === "Completed");
        const contribution = assignedTasks.length
            ? Math.round((completedTasks.length / assignedTasks.length) * 100)
            : 0;

        const assignedCount = document.getElementById("assigned-tasks");
        const completedCount = document.getElementById("completed-tasks");

        if (assignedCount) {
            assignedCount.textContent = assignedTasks.length;
        }

        if (completedCount) {
            completedCount.textContent = completedTasks.length;
        }
        const assignedDescription = document.querySelector("#assigned-tasks + .stat-description");
        const completedDescription = document.querySelector("#completed-tasks + .stat-description");
        if (assignedDescription) {
            assignedDescription.textContent = assignedTasks.length
                ? "Tasks assigned to you"
                : "No tasks assigned";
        }
        if (completedDescription) {
            completedDescription.textContent = completedTasks.length
                ? "Tasks completed"
                : "Keep making progress";
        }

        const contributionText = document.getElementById("contribution-percentage");
        const contributionCircle = document.getElementById("progress-circle");
        const summaryText = document.getElementById("summary-percentage");
        const summaryCircle = document.getElementById("summary-circle");
        if (contributionText) contributionText.textContent = `${contribution}%`;
        if (contributionCircle) {
            contributionCircle.style.setProperty("--progress", `${contribution}%`);
            contributionCircle.setAttribute("aria-valuenow", String(contribution));
        }
        if (summaryText) summaryText.textContent = `${contribution}%`;
        if (summaryCircle) summaryCircle.style.setProperty("--summary-progress", `${contribution}%`);

        if (tasks.length === 0) {
            taskList.innerHTML = `
                <div class="task-empty-state">
                    <span class="task-check">✓</span>
                    <h3>No Tasks Yet</h3>
                    <p>Start by adding your first task.</p>
                </div>
            `;
            return;
        }

        tasks.forEach(function (task, index) {
            const card = document.createElement("div");
            card.className = "saved-task-card";

            const heading = document.createElement("h3");
            heading.textContent = task.name || "Untitled Task";

            const description = document.createElement("p");
            description.textContent =
                task.description || "No description provided.";

            const assignee = document.createElement("p");
            assignee.textContent =
                "Assigned to: " + (task.assignee || "Not assigned");

            const deadline = document.createElement("p");
            deadline.textContent =
                "Due date: " + (task.deadline || "Not set");

            const status = document.createElement("span");
            status.className = "task-status-badge";
            status.textContent = task.status || "Pending";

            const actions = document.createElement("div");
            actions.className = "task-actions";

            // EDIT BUTTON

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "task-edit-btn";
            editBtn.textContent = " Edit";

            editBtn.addEventListener("click", function () {
                const newName = prompt(
                    "Enter task name:",
                    task.name || ""
                );

                if (newName === null) return;

                if (!newName.trim()) {
                    alert("Task name cannot be empty.");
                    return;
                }

                const newDescription = prompt(
                    "Enter task description:",
                    task.description || ""
                );

                if (newDescription === null) return;

                const newAssignee = prompt(
                    "Enter assigned person's name:",
                    task.assignee || ""
                );

                if (newAssignee === null) return;

                const newDeadline = prompt(
                    "Enter deadline (YYYY-MM-DD):",
                    task.deadline || ""
                );

                if (newDeadline === null) return;

                const previousTask = { ...tasks[index] };

                tasks[index] = {
                    ...task,
                    name: newName.trim(),
                    description: newDescription.trim(),
                    assignee: newAssignee.trim(),
                    deadline: newDeadline.trim()
                };

                if (saveTasks()) {
                    renderTasks();
                } else {
                    tasks[index] = previousTask;
                }
            });

            // DELETE BUTTON

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "task-delete-btn";
            deleteBtn.textContent = "Delete";

            deleteBtn.addEventListener("click", function () {
                const confirmed = confirm(
                    "Are you sure you want to delete this task?"
                );

                if (!confirmed) return;

                const removedTask = tasks.splice(index, 1)[0];

                if (saveTasks()) {
                    renderTasks();
                } else {
                    tasks.splice(index, 0, removedTask);
                    renderTasks();
                }
            });

            // MARK COMPLETE / PENDING BUTTON

            const completeBtn = document.createElement("button");
            completeBtn.type = "button";
            completeBtn.className = "task-complete-btn";

            completeBtn.textContent =
                task.status === "Completed"
                    ? " Mark Pending"
                    : " Mark Complete";

            completeBtn.addEventListener("click", function () {
                const previousStatus = task.status;

                tasks[index].status =
                    previousStatus === "Completed"
                        ? "Pending"
                        : "Completed";

                if (saveTasks()) {
                    renderTasks();
                } else {
                    tasks[index].status = previousStatus;
                }
            });

            actions.append(editBtn, deleteBtn, completeBtn);

            card.append(
                heading,
                description,
                assignee,
                deadline,
                status,
                actions
            );

            taskList.appendChild(card);
        });
    }

    // ADD TASK BUTTON

    addTaskBtn.addEventListener("click", function () {
        if (document.getElementById("task-modal")) return;

        const modal = document.createElement("div");
        modal.id = "task-modal";
        modal.className = "project-modal";

        modal.innerHTML = `
            <div class="project-modal-content">

                <button type="button"
                    class="modal-close"
                    id="close-task-modal"
                    aria-label="Close">&times;</button>

                <h2>Add New Task</h2>

                <p class="modal-subtitle">
                    Add a task and track your progress.
                </p>

                <form id="task-form" class="task-form-grid">
                    <div class="task-form-field">
                        <label for="task-name">Task Name</label>
                        <input type="text"
                        id="task-name"
                        placeholder="e.g. Create homepage"
                        required>
                    </div>
                    <div class="task-form-field">
                        <label for="task-assignee">Assigned To</label>
                        <input type="text"
                            id="task-assignee"
                            placeholder="Enter student name"
                            required>
                    </div>
                    <div class="task-form-field task-form-field-wide">
                        <label for="task-description">Description</label>
                        <textarea id="task-description"
                        placeholder="Describe your task"
                        rows="3"></textarea>
                    </div>
                    <div class="task-form-field">
                        <label for="task-deadline">Due Date</label>
                        <input type="date"
                        id="task-deadline"
                        required>
                    </div>
                    <div class="task-form-field">
                        <label for="task-status">Task Status</label>
                        <select id="task-status">
                            <option value="Pending">Pending</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Completed">Completed</option>
                        </select>
                    </div>
                    <div class="task-form-actions">
                        <button type="submit" class="modal-submit">Save Task</button>
                    </div>

                </form>
            </div>
        `;

        document.body.appendChild(modal);

        const assigneeInput = document.getElementById("task-assignee");
        if (currentTaskUser && currentTaskUser.name) assigneeInput.value = currentTaskUser.name;

        const deadlineInput =
            document.getElementById("task-deadline");

        const today = new Date();

        deadlineInput.min = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");

        function closeTaskModal() {
            modal.remove();
        }

        document.getElementById("close-task-modal")
            .addEventListener("click", closeTaskModal);

        modal.addEventListener("click", function (event) {
            if (event.target === modal) {
                closeTaskModal();
            }
        });

        // SAVE TASK

        document.getElementById("task-form")
            .addEventListener("submit", function (event) {
                event.preventDefault();

                const task = {
                    id: Date.now().toString(),
                    name: document.getElementById("task-name").value.trim(),
                    description: document.getElementById("task-description").value.trim(),
                    assignee: document.getElementById("task-assignee").value.trim(),
                    deadline: deadlineInput.value,
                    status: document.getElementById("task-status").value
                };

                if (
                    !task.name ||
                    !task.assignee ||
                    !task.deadline
                ) {
                    alert("Please fill in all required fields.");
                    return;
                }

                tasks.push(task);

                if (saveTasks()) {
                    closeTaskModal();
                    renderTasks();
                } else {
                    tasks.pop();
                }
            });
    });

    // Initial Render

    window.addEventListener("teamproof:profile-ready", function (event) {
        currentTaskUser = event.detail || null;
        renderTasks();
    }, { once: true });
    renderTasks();
});


// ==========================================
// TEAMPROOF HOME PAGE PROJECT OVERVIEW
// ==========================================

document.addEventListener("DOMContentLoaded", function () {
    let tasks = [];

    try {
        const savedTasks = JSON.parse(
            localStorage.getItem("teamproofTasks") || "[]"
        );

        tasks = Array.isArray(savedTasks) ? savedTasks : [];
    } catch (error) {
        console.error("Could not load home page task statistics:", error);
    }

    const completedTasks = tasks.filter(function (task) {
        return task.status === "Completed";
    }).length;

    const totalTasks = tasks.length;

    const progress = totalTasks > 0
        ? Math.round((completedTasks / totalTasks) * 100)
        : 0;

    const tasksCompletedElement =
        document.getElementById("home-tasks-completed");

    const progressFill =
        document.getElementById("home-progress-fill");

    const progressText =
        document.getElementById("home-progress-text");

    if (tasksCompletedElement) {
        tasksCompletedElement.textContent = completedTasks;
    }

    if (progressFill) {
        progressFill.style.width = progress + "%";
    }

    if (progressText) {
        progressText.textContent = progress + "%";
    }
});
