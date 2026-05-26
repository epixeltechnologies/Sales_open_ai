const express = require('express');
const router = express.Router();
const controller = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const {
  signupValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
} = require('../middleware/validation');

router.post('/signup', signupValidator, controller.signup);
router.post('/login', loginValidator, controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', authenticate, controller.logout);
router.post('/forgot-password', forgotPasswordValidator, controller.forgotPassword);
router.post('/reset-password', resetPasswordValidator, controller.resetPassword);
router.get('/me', authenticate, controller.getMe);

module.exports = router;
