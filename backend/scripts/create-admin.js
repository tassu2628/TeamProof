const path = require("path");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const User = require("../models/User");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

async function createAdmin() {
    const name = process.env.ADMIN_NAME?.trim();
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI must be configured.");
    if (!name || name.length > 100 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Set a valid ADMIN_NAME and ADMIN_EMAIL in the backend environment.");
    }
    if (typeof password !== "string" || Buffer.byteLength(password, "utf8") < 12 || Buffer.byteLength(password, "utf8") > 72) {
        throw new Error("ADMIN_PASSWORD must be between 12 and 72 bytes.");
    }

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    const existing = await User.findOne({ email }).select("role");
    if (existing) {
        if (existing.role === "admin") {
            console.log("An administrator account already exists for that email.");
            return;
        }
        throw new Error("That email already belongs to a non-admin account; refusing to elevate it.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({ name, email, passwordHash, role: "admin" });
    console.log("Administrator account created. Sign in through the TeamProof login page.");
}

createAdmin()
    .catch(error => {
        console.error(`Admin provisioning failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
