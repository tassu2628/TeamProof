const mongoose = require("mongoose");

async function connectDB() {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
        throw new Error("MONGO_URI is missing. Add it to backend/.env.");
    }

    try {
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000
        });
        console.log("MongoDB connected successfully.");
        return mongoose.connection;
    } catch (error) {
        throw new Error(`MongoDB connection failed: ${error.message}`, {
            cause: error
        });
    }
}

module.exports = connectDB;
