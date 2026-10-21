const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const Project = require("../models/Project");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const statuses = ["Pending", "In Progress", "Completed"];
router.use(authenticateToken);

const validId = id => /^[a-f\d]{24}$/i.test(id) && mongoose.isValidObjectId(id);
const sendError = (res, status, message) => res.status(status).json({ success: false, message });
const sameId = (left, right) => Boolean(left && right && left.toString() === right.toString());
const canAccessProject = (project, userId) => sameId(project.createdBy, userId) ||
    project.members.some(member => sameId(member, userId));
const canManageTask = (task, project, userId) => sameId(task.createdBy, userId) || sameId(project.createdBy, userId);

function parseDeadline(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
    const day = value.slice(0, 10);
    const calendarDay = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== day) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function validSubmissionLink(value) {
    if (value === "") return true;
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch (error) {
        return false;
    }
}

router.get("/stats/contribution", async (req, res, next) => {
    try {
        const projects = await Project.find({ $or: [{ createdBy: req.user._id }, { members: req.user._id }] }).select("_id");
        const accessFilter = { assignee: req.user._id, project: { $in: projects.map(project => project._id) } };
        const total = await Task.countDocuments(accessFilter);
        const completed = await Task.countDocuments({
            ...accessFilter,
            status: "Completed",
            verificationStatus: "approved"
        });
        const score = total ? Math.round(completed / total * 100) : 0;
        return res.json({ success: true, total, completed, score });
    } catch (error) { return next(error); }
});

router.get("/options", async (req, res, next) => {
    if (!validId(req.query.projectId)) return sendError(res, 400, "Project ID is invalid.");
    try {
        const project = await Project.findById(req.query.projectId).populate("members", "name email role");
        if (!project || !canAccessProject(project, req.user._id)) return sendError(res, 404, "Project not found.");
        const members = project.members.filter(Boolean).map(member => ({ id: member._id.toString(), name: member.name, email: member.email }));
        return res.json({ success: true, members });
    } catch (error) { return next(error); }
});

router.post("/", async (req, res, next) => {
    const body = req.body || {};
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 150) return sendError(res, 400, "title is required and must be 150 characters or fewer.");
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000)) return sendError(res, 400, "description must be text with 2000 characters or fewer.");
    if (!validId(body.projectId) || !validId(body.assigneeId)) return sendError(res, 400, "A valid project and assignee are required.");
    const deadline = parseDeadline(body.deadline);
    if (!deadline) return sendError(res, 400, "deadline must be a valid date.");
    if (body.status !== undefined && !statuses.includes(body.status)) return sendError(res, 400, "Task status is invalid.");
    if (!validSubmissionLink(body.submissionLink || "")) return sendError(res, 400, "submissionLink must be a valid HTTP or HTTPS URL.");
    try {
        const project = await Project.findById(body.projectId);
        if (!project || !canAccessProject(project, req.user._id)) return sendError(res, 404, "Project not found.");
        const assignedToMember = project.members.some(member => sameId(member, body.assigneeId));
        if (!assignedToMember) return sendError(res, 400, "The assignee must be a member of this project.");
        const task = await Task.create({
            title: body.title.trim(), description: typeof body.description === "string" ? body.description.trim() : "", project: project._id,
            createdBy: req.user._id, assignee: body.assigneeId, deadline,
            status: body.status || "Pending", submissionLink: body.submissionLink || "",
            verificationStatus: body.status === "Completed" && body.submissionLink ? "pending" : "not-submitted"
        });
        await task.populate([{ path: "assignee", select: "name email" }, { path: "createdBy", select: "name email" }, { path: "project", select: "projectName createdBy" }]);
        return res.status(201).json({ success: true, task });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") return sendError(res, 400, "Task fields are invalid.");
        return next(error);
    }
});

router.get("/", async (req, res, next) => {
    try {
        const projects = await Project.find({ $or: [{ createdBy: req.user._id }, { members: req.user._id }] }).select("_id");
        const tasks = await Task.find({ project: { $in: projects.map(project => project._id) } })
            .populate("assignee", "name email")
            .populate("createdBy", "name email")
            .populate({ path: "project", select: "projectName createdBy" })
            .sort({ deadline: 1, createdAt: -1 });
        return res.json({ success: true, tasks });
    } catch (error) { return next(error); }
});

router.get("/:id", async (req, res, next) => {
    if (!validId(req.params.id)) return sendError(res, 400, "Task ID is invalid.");
    try {
        const task = await Task.findById(req.params.id)
            .populate("assignee", "name email")
            .populate("createdBy", "name email")
            .populate({ path: "project", select: "projectName createdBy members" });
        if (!task || !canAccessProject(task.project, req.user._id)) return sendError(res, 404, "Task not found.");
        return res.json({ success: true, task });
    } catch (error) { return next(error); }
});

router.put("/:id", async (req, res, next) => {
    if (!validId(req.params.id)) return sendError(res, 400, "Task ID is invalid.");
    const body = req.body || {};
    try {
        const task = await Task.findById(req.params.id);
        if (!task) return sendError(res, 404, "Task not found.");
        const project = await Project.findById(task.project);
        if (!project || !canAccessProject(project, req.user._id)) return sendError(res, 404, "Task not found.");
        const manager = canManageTask(task, project, req.user._id);
        const assignee = sameId(task.assignee, req.user._id);
        if (!manager && !assignee) return sendError(res, 403, "You cannot modify this task.");
        if (!manager && Object.keys(body).some(key => !["status", "submissionLink"].includes(key))) return sendError(res, 403, "Assignees may only update task status and submission link.");
        if (manager && Object.keys(body).some(key => !["title", "description", "assigneeId", "deadline", "status", "submissionLink"].includes(key))) return sendError(res, 400, "One or more task fields are not editable.");
        if (!Object.keys(body).length) return sendError(res, 400, "Provide at least one task field to update.");
        const taskDetailsChanged = ["title", "description", "assigneeId", "deadline"].some(key => body[key] !== undefined);

        if (body.title !== undefined) {
            if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 150) return sendError(res, 400, "title is required and must be 150 characters or fewer.");
            task.title = body.title.trim();
        }
        if (body.description !== undefined) {
            if (typeof body.description !== "string" || body.description.length > 2000) return sendError(res, 400, "description must be 2000 characters or fewer.");
            task.description = body.description.trim();
        }
        if (body.deadline !== undefined) {
            const deadline = parseDeadline(body.deadline);
            if (!deadline) return sendError(res, 400, "deadline must be a valid date.");
            task.deadline = deadline;
        }
        if (body.assigneeId !== undefined) {
            if (!validId(body.assigneeId)) return sendError(res, 400, "Assignee ID is invalid.");
            if (!project.members.some(member => sameId(member, body.assigneeId))) return sendError(res, 400, "The assignee must be a member of this project.");
            task.assignee = body.assigneeId;
        }
        if (body.submissionLink !== undefined) {
            if (!validSubmissionLink(body.submissionLink)) return sendError(res, 400, "submissionLink must be a valid HTTP or HTTPS URL.");
            task.submissionLink = body.submissionLink;
        }
        if (body.status !== undefined) {
            if (!statuses.includes(body.status)) return sendError(res, 400, "Task status is invalid.");
            task.status = body.status;
        }
        if (taskDetailsChanged || body.status !== undefined || body.submissionLink !== undefined) {
            task.verificationStatus = task.status === "Completed" && task.submissionLink ? "pending" : "not-submitted";
            task.verifiedBy = null;
            task.verifiedAt = null;
        }
        await task.save();
        await task.populate([{ path: "assignee", select: "name email" }, { path: "createdBy", select: "name email" }, { path: "project", select: "projectName createdBy" }]);
        return res.json({ success: true, task });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") return sendError(res, 400, "Task fields are invalid.");
        return next(error);
    }
});

router.delete("/:id", async (req, res, next) => {
    if (!validId(req.params.id)) return sendError(res, 400, "Task ID is invalid.");
    try {
        const task = await Task.findById(req.params.id);
        if (!task) return sendError(res, 404, "Task not found.");
        const project = await Project.findById(task.project);
        if (!project || !canAccessProject(project, req.user._id)) return sendError(res, 404, "Task not found.");
        if (!canManageTask(task, project, req.user._id)) return sendError(res, 403, "Only the task creator or project owner can delete this task.");
        await task.deleteOne();
        return res.json({ success: true, message: "Task deleted successfully." });
    } catch (error) { return next(error); }
});

module.exports = router;
