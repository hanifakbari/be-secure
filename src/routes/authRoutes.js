// src/routes/authRoutes.js
const express = require("express");
const { body } = require("express-validator");
const authController = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Validation rules
const registerVendorValidation = [
  body("email").isEmail().normalizeEmail().withMessage("Invalid email format"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase, and number"),
  body("company_name")
    .trim()
    .notEmpty()
    .withMessage("Company name is required"),
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone is required")
    .matches(/^(\+62|62|0)[0-9]{9,12}$/)
    .withMessage("Invalid Indonesian phone number"),
  body("address").trim().notEmpty().withMessage("Address is required"),
];

const registerClientValidation = [
  body("email").isEmail().normalizeEmail().withMessage("Invalid email format"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase, and number"),
  body("contact_person")
    .trim()
    .notEmpty()
    .withMessage("Contact person is required"),
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone is required")
    .matches(/^(\+62|62|0)[0-9]{9,12}$/)
    .withMessage("Invalid Indonesian phone number"),
];

const loginValidation = [
  body("email").isEmail().normalizeEmail().withMessage("Invalid email format"),
  body("password").notEmpty().withMessage("Password is required"),
];

// Public routes
router.post(
  "/register/vendor",
  registerVendorValidation,
  authController.registerVendor
);
router.post(
  "/register/client",
  registerClientValidation,
  authController.registerClient
);
router.post("/login", loginValidation, authController.login);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);

// Protected routes
router.get("/profile", authenticateToken, authController.getProfile);

module.exports = router;
