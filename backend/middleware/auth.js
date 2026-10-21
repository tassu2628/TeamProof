const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function authenticateToken(req, res, next) {
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
        return res.status(401).json({
            success: false,
            message: "Authentication required. Please sign in."
        });
    }

    try {
        const payload = jwt.verify(match[1], process.env.JWT_SECRET, {
            algorithms: ["HS256"]
        });
        if (!payload.sub) throw new Error("Token subject is missing.");

        const user = await User.findById(payload.sub);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Authentication token is invalid or expired."
            });
        }

        req.user = user;
        return next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError" ||
            error.name === "CastError") {
            return res.status(401).json({
                success: false,
                message: "Authentication token is invalid or expired."
            });
        }
        return next(error);
    }
}

function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. Please sign in."
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to access this resource."
            });
        }

        return next();
    };
}

module.exports = { authenticateToken, authorizeRoles };
