const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const allowedPublicRoles = ["student", "team-leader", "faculty"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeUser(user) {
    return {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
    };
}

function createToken(user) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
    }

    return jwt.sign({}, process.env.JWT_SECRET, {
        algorithm: "HS256",
        subject: user._id.toString(),
        expiresIn: "1h"
    });
}

router.post("/signup", async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body || {};

        if ([name, email, password, role].some(value =>
            typeof value !== "string" || !value.trim())) {
            return res.status(400).json({
                success: false,
                message: "Name, email, password, and role are required."
            });
        }

        const normalizedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        if (normalizedName.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Name must be 100 characters or fewer."
            });
        }

        if (normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid email address."
            });
        }

        if (Buffer.byteLength(password, "utf8") < 8 ||
            Buffer.byteLength(password, "utf8") > 72) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters and no more than 72 bytes."
            });
        }

        if (!allowedPublicRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: "Please select a valid account role. Admin accounts cannot be created through public signup."
            });
        }

        const existingUser = await User.findOne({ email: normalizedEmail }).select("_id");
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "An account with this email address already exists."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await User.create({
            name: normalizedName,
            email: normalizedEmail,
            passwordHash,
            role
        });

        return res.status(201).json({
            success: true,
            message: "Account created successfully.",
            token: createToken(user),
            user: safeUser(user)
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "An account with this email address already exists."
            });
        }
        return next(error);
    }
});

router.post("/login", async (req, res, next) => {
    try {
        const { email, password } = req.body || {};

        if (typeof email !== "string" || !email.trim() ||
            typeof password !== "string" || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail })
            .select("+passwordHash");

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        return res.json({
            success: true,
            message: "Signed in successfully.",
            token: createToken(user),
            user: safeUser(user)
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/me", authenticateToken, (req, res) => {
    return res.json({
        success: true,
        user: safeUser(req.user)
    });
});

module.exports = router;
