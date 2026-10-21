const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const User = require("../models/User");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?)?$/;
const editableFields = ["projectName", "description", "teamName", "startDate", "deadline", "status"];

router.use(authenticateToken);

function validateId(id) {
    return /^[a-f\d]{24}$/i.test(id) && mongoose.isValidObjectId(id);
}

function dateFromInput(value) {
    if (typeof value !== "string" || !datePattern.test(value)) return null;
    const datePart = value.slice(0, 10);
    const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
    if (Number.isNaN(calendarDate.getTime()) ||
        calendarDate.toISOString().slice(0, 10) !== datePart) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isMember(project, userId) {
    return project.members.some(member => member.equals(userId));
}

function canView(project, userId) {
    return project.createdBy.equals(userId) || isMember(project, userId);
}

function isOwner(project, userId) {
    return project.createdBy.equals(userId);
}

function sendValidationError(res, message) {
    return res.status(400).json({ success: false, message });
}

function validateProjectFields(body, { creating = false } = {}) {
    const fields = {};

    for (const key of ["projectName", "description", "teamName"]) {
        if (!creating && body[key] === undefined) continue;
        if (typeof body[key] !== "string" || !body[key].trim()) {
            return { error: `${key} is required and must be text.` };
        }

        const value = body[key].trim();
        const maxLength = key === "description" ? 1000 : 100;
        if (value.length > maxLength) {
            return { error: `${key} must be ${maxLength} characters or fewer.` };
        }
        fields[key] = value;
    }

    for (const key of ["startDate", "deadline"]) {
        if (body[key] === undefined && (!creating || key === "startDate")) continue;
        const value = dateFromInput(body[key]);
        if (!value) return { error: `${key} must be a valid ISO date.` };
        fields[key] = value;
    }

    if (body.status !== undefined) {
        if (!["Active", "Completed", "On Hold"].includes(body.status)) {
            return { error: "status must be Active, Completed, or On Hold." };
        }
        fields.status = body.status;
    }

    if (creating && fields.startDate === undefined) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        fields.startDate = today;
    }

    const startDate = fields.startDate;
    const deadline = fields.deadline;
    if (startDate && deadline && deadline < startDate) {
        return { error: "deadline cannot be earlier than startDate." };
    }

    if (!creating && Object.keys(fields).length === 0) {
        return { error: "Provide at least one editable project field." };
    }

    return { fields };
}

router.post("/", async (req, res, next) => {
    const validation = validateProjectFields(req.body || {}, { creating: true });
    if (validation.error) return sendValidationError(res, validation.error);

    try {
        const project = await Project.create({
            ...validation.fields,
            createdBy: req.user._id,
            members: [req.user._id]
        });

        return res.status(201).json({
            success: true,
            message: "Project created successfully.",
            project
        });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") {
            return sendValidationError(res, "Project fields are invalid.");
        }
        return next(error);
    }
});

router.get("/", async (req, res, next) => {
    try {
        const projects = await Project.find({
            $or: [
                { createdBy: req.user._id },
                { members: req.user._id }
            ]
        }).sort({ updatedAt: -1 });

        return res.json({ success: true, projects });
    } catch (error) {
        return next(error);
    }
});

router.post("/:id/members", async (req, res, next) => {
    if (!validateId(req.params.id)) return sendValidationError(res, "Project ID is invalid.");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendValidationError(res, "Provide a valid student email address.");
    }
    try {
        const project = await Project.findById(req.params.id);
        if (!project) return res.status(404).json({ success: false, message: "Project not found." });
        if (!isOwner(project, req.user._id)) return res.status(403).json({ success: false, message: "Only the project owner can add members." });
        const member = await User.findOne({ email, role: "student" }).select("name email role");
        if (!member) return res.status(404).json({ success: false, message: "No student account was found for that email." });
        if (project.members.some(existing => existing.equals(member._id))) {
            return res.status(409).json({ success: false, message: "That student is already a project member." });
        }
        project.members.push(member._id);
        await project.save();
        return res.status(201).json({
            success: true,
            message: "Student added to the project.",
            member: { id: member._id.toString(), name: member.name, email: member.email }
        });
    } catch (error) { return next(error); }
});

router.get("/:id", async (req, res, next) => {
    if (!validateId(req.params.id)) {
        return sendValidationError(res, "Project ID is invalid.");
    }

    try {
        const project = await Project.findById(req.params.id);
        if (!project || !canView(project, req.user._id)) {
            return res.status(404).json({ success: false, message: "Project not found." });
        }

        return res.json({ success: true, project });
    } catch (error) {
        return next(error);
    }
});

router.put("/:id", async (req, res, next) => {
    if (!validateId(req.params.id)) {
        return sendValidationError(res, "Project ID is invalid.");
    }

    const validation = validateProjectFields(req.body || {});
    if (validation.error) return sendValidationError(res, validation.error);

    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, message: "Project not found." });
        }
        if (!isOwner(project, req.user._id)) {
            return res.status(isMember(project, req.user._id) ? 403 : 404).json({
                success: false,
                message: isMember(project, req.user._id)
                    ? "Only the project owner can edit this project."
                    : "Project not found."
            });
        }

        const nextStart = validation.fields.startDate || project.startDate;
        const nextDeadline = validation.fields.deadline || project.deadline;
        if (nextDeadline < nextStart) {
            return sendValidationError(res, "deadline cannot be earlier than startDate.");
        }

        Object.assign(project, validation.fields);
        await project.save();

        return res.json({ success: true, message: "Project updated successfully.", project });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") {
            return sendValidationError(res, "Project fields are invalid.");
        }
        return next(error);
    }
});

router.delete("/:id", async (req, res, next) => {
    if (!validateId(req.params.id)) {
        return sendValidationError(res, "Project ID is invalid.");
    }

    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, message: "Project not found." });
        }
        if (!isOwner(project, req.user._id)) {
            return res.status(isMember(project, req.user._id) ? 403 : 404).json({
                success: false,
                message: isMember(project, req.user._id)
                    ? "Only the project owner can delete this project."
                    : "Project not found."
            });
        }

        await project.deleteOne();
        return res.json({ success: true, message: "Project deleted successfully." });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
