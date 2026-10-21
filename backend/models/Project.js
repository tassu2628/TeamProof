const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
    projectName: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 100
    },
    description: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 1000
    },
    teamName: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 100
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],
    startDate: {
        type: Date,
        required: true,
        default: () => {
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            return today;
        }
    },
    deadline: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ["Active", "Completed", "On Hold"],
        default: "Active",
        required: true
    }
}, {
    timestamps: true,
    versionKey: false
});

projectSchema.index({ members: 1 });

module.exports = mongoose.model("Project", projectSchema);
