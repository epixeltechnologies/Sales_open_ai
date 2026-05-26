const { validationResult, body, param, query } = require('express-validator');
const { sendError } = require('../utils/responseHelpers');

// Middleware to check validation results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
      value: err.value,
    }));
    return sendError(res, 'Validation failed', 422, formattedErrors);
  }
  next();
};

// Auth validators
const signupValidator = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
  body('companyName')
    .trim()
    .notEmpty().withMessage('Company name is required')
    .isLength({ min: 2, max: 200 }).withMessage('Company name must be 2-200 characters'),
  validate,
];

const loginValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required'),
  validate,
];

const forgotPasswordValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  validate,
];

const resetPasswordValidator = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
  validate,
];

// Agent settings validator
const agentSettingsValidator = [
  body('agentName')
    .trim()
    .notEmpty().withMessage('Agent name is required')
    .isLength({ min: 1, max: 50 }).withMessage('Agent name must be 1-50 characters'),
  body('welcomeMessage')
    .trim()
    .notEmpty().withMessage('Welcome message is required')
    .isLength({ min: 10, max: 500 }).withMessage('Welcome message must be 10-500 characters'),
  body('temperature')
    .isFloat({ min: 0, max: 1 }).withMessage('Temperature must be between 0 and 1'),
  validate,
];

// Lead validator
const leadUpdateValidator = [
  body('status')
    .optional()
    .isIn(['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'APPOINTMENT_BOOKED', 'CONVERTED', 'LOST'])
    .withMessage('Invalid status'),
  body('notes')
    .optional()
    .isLength({ max: 2000 }).withMessage('Notes must be less than 2000 characters'),
  validate,
];

// Pagination validator
const paginationValidator = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  validate,
];

module.exports = {
  validate,
  signupValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  agentSettingsValidator,
  leadUpdateValidator,
  paginationValidator,
};
