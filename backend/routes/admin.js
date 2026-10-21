const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Project = require("../models/Project");
const Task = require("../models/Task");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken, authorizeRoles("admin"));
const validId = id => /^[a-f\d]{24}$/i.test(id) && mongoose.isValidObjectId(id);

router.get("/stats", async (req, res, next) => {
    try {
        const [students, projects, tasks, pendingVerification] = await Promise.all([
            User.countDocuments({ role: "student" }),
            Project.countDocuments(),
            Task.countDocuments(),
            Task.countDocuments({ status: "Completed", verificationStatus: "pending" })
        ]);
        return res.json({ success: true, stats: { students, projects, tasks, pendingVerification } });
    } catch (error) { return next(error); }
});

router.get("/students", async (req, res, next) => {
    try {
        const students = await User.find({ role: "student" })
            .select("name email role createdAt")
            .sort({ createdAt: -1 });
        return res.json({ success: true, students });
    } catch (error) { return next(error); }
});

router.get("/projects", async (req, res, next) => {
    try {
        const projects = await Project.find()
            .populate("createdBy", "name email")
            .populate("members", "name email")
            .sort({ updatedAt: -1 });
        return res.json({ success: true, projects });
    } catch (error) { return next(error); }
});

router.get("/tasks/pending", async (req, res, next) => {
    try {
        const tasks = await Task.find({ status: "Completed", verificationStatus: "pending" })
            .populate("assignee", "name email")
            .populate("createdBy", "name email")
            .populate("project", "projectName")
            .sort({ updatedAt: 1 });
        return res.json({ success: true, tasks });
    } catch (error) { return next(error); }
});

router.put("/tasks/:id/verification", async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Task ID is invalid." });
    const { decision } = req.body || {};
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ success: false, message: "decision must be approve or reject." });
    try {
        const task = await Task.findOne({ _id: req.params.id, status: "Completed", verificationStatus: "pending" });
        if (!task) return res.status(404).json({ success: false, message: "Pending task submission not found." });
        task.verificationStatus = decision === "approve" ? "approved" : "rejected";
        task.verifiedBy = req.user._id;
        task.verifiedAt = new Date();
        await task.save();
        await task.populate([{ path: "assignee", select: "name email" }, { path: "verifiedBy", select: "name email" }, { path: "project", select: "projectName" }]);
        return res.json({ success: true, message: `Task ${decision === "approve" ? "approved" : "rejected"}.`, task });
    } catch (error) { return next(error); }
});

module.exports = router;
