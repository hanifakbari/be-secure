// src/controllers/authController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const { validationResult } = require("express-validator");

// Generate JWT tokens
const generateTokens = (userId, email, role) => {
  const accessToken = jwt.sign(
    { userId, email, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  });

  return { accessToken, refreshToken };
};

// Store refresh token in database
const storeRefreshToken = async (userId, refreshToken) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await pool.query(
    "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [userId, refreshToken, expiresAt]
  );
};

// Register Vendor (Self-Registration)
exports.registerVendor = async (req, res) => {
  const client = await pool.connect();

  try {
    // Validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    await client.query("BEGIN");

    const { email, password, company_name, phone, address, npwp } = req.body;

    // Check if email already exists
    const existingUser = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role`,
      [email, passwordHash, "vendor", true, false]
    );

    const user = userResult.rows[0];

    // Create vendor profile
    await client.query(
      `INSERT INTO vendors 
       (user_id, company_name, phone, address, npwp, status, registration_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, company_name, phone, address, npwp, "pending", "self_register"]
    );

    await client.query("COMMIT");

    // TODO: Send verification email

    res.status(201).json({
      success: true,
      message: "Registration successful! Your account is pending approval.",
      data: {
        email: user.email,
        status: "pending",
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register vendor error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Register Client
exports.registerClient = async (req, res) => {
  const client = await pool.connect();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    await client.query("BEGIN");

    const { email, password, company_name, contact_person, phone, address } =
      req.body;

    // Check if email exists
    const existingUser = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role`,
      [email, passwordHash, "client", true, false]
    );

    const user = userResult.rows[0];

    // Create client profile
    await client.query(
      `INSERT INTO clients 
       (user_id, company_name, contact_person, phone, address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, company_name, contact_person, phone, address]
    );

    await client.query("COMMIT");

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(
      user.id,
      user.email,
      user.role
    );

    await storeRefreshToken(user.id, refreshToken);

    res.status(201).json({
      success: true,
      message: "Registration successful!",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register client error:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    // Get user
    const userResult = await pool.query(
      "SELECT id, email, password_hash, role, is_active FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = userResult.rows[0];

    // Check if account is active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Account is inactive. Please contact support.",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // For vendors, check approval status
    if (user.role === "vendor") {
      const vendorResult = await pool.query(
        "SELECT status FROM vendors WHERE user_id = $1",
        [user.id]
      );

      const vendorStatus = vendorResult.rows[0]?.status;

      if (vendorStatus === "pending") {
        return res.status(403).json({
          success: false,
          message:
            "Your account is pending approval. Please wait for admin verification.",
        });
      }

      if (vendorStatus === "rejected") {
        return res.status(403).json({
          success: false,
          message: "Your account has been rejected. Please contact support.",
        });
      }

      if (vendorStatus === "suspended") {
        return res.status(403).json({
          success: false,
          message: "Your account has been suspended. Please contact support.",
        });
      }
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(
      user.id,
      user.email,
      user.role
    );

    await storeRefreshToken(user.id, refreshToken);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
};

// Refresh Token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Check if token exists in database
    const tokenResult = await pool.query(
      "SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2",
      [refreshToken, decoded.userId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const storedToken = tokenResult.rows[0];

    // Check if token expired
    if (new Date() > new Date(storedToken.expires_at)) {
      await pool.query("DELETE FROM refresh_tokens WHERE id = $1", [
        storedToken.id,
      ]);
      return res.status(403).json({
        success: false,
        message: "Refresh token expired",
      });
    }

    // Get user info
    const userResult = await pool.query(
      "SELECT id, email, role FROM users WHERE id = $1",
      [decoded.userId]
    );

    const user = userResult.rows[0];

    // Generate new tokens
    const tokens = generateTokens(user.id, user.email, user.role);

    // Delete old refresh token
    await pool.query("DELETE FROM refresh_tokens WHERE id = $1", [
      storedToken.id,
    ]);

    // Store new refresh token
    await storeRefreshToken(user.id, tokens.refreshToken);

    res.json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(403).json({
      success: false,
      message: "Invalid refresh token",
    });
  }
};

// Logout
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [
        refreshToken,
      ]);
    }

    res.json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

// Get current user profile
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let profileData = {
      id: userId,
      email: req.user.email,
      role: role,
    };

    if (role === "vendor") {
      const vendorResult = await pool.query(
        `SELECT v.*, u.email 
         FROM vendors v
         JOIN users u ON v.user_id = u.id
         WHERE v.user_id = $1`,
        [userId]
      );
      profileData = { ...profileData, ...vendorResult.rows[0] };
    } else if (role === "client") {
      const clientResult = await pool.query(
        `SELECT c.*, u.email 
         FROM clients c
         JOIN users u ON c.user_id = u.id
         WHERE c.user_id = $1`,
        [userId]
      );
      profileData = { ...profileData, ...clientResult.rows[0] };
    }

    res.json({
      success: true,
      data: profileData,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
    });
  }
};
