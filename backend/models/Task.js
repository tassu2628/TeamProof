const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deadline: { type: Date, required: true },
    status: { type: String, enum: ["Pending", "In Progress", "Completed"], default: "Pending", required: true },
    submissionLink: { type: String, trim: true, maxlength: 2048, default: "" },
    verificationStatus: {
        type: String,
        enum: ["not-submitted", "pending", "approved", "rejected"],
        default: "not-submitted",
        required: true,
        index: true
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

taskSchema.index({ assignee: 1, status: 1, verificationStatus: 1 });

module.exports = mongoose.model("Task", taskSchema);
