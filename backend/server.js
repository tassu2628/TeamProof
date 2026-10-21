const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const projectRoutes = require("./routes/projects");
const taskRoutes = require("./routes/tasks");
const adminRoutes = require("./routes/admin");

// Resolve .env relative to this file so startup works from the project root
// or from the backend directory.
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    }
}));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (req, res) => {
    res.send("TeamProof Backend Server is Running!");
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "TeamProof API is working!"
    });
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
        ? error.status
        : 500;

    return res.status(status).json({
        success: false,
        message: status === 500 ? "An unexpected server error occurred." : error.message
    });
});

async function startServer() {
    try {
        await connectDB();

        const port = process.env.PORT || 5000;
        return app.listen(port, () => {
            console.log(`TeamProof server running at http://localhost:${port}`);
        });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
        return null;
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };
