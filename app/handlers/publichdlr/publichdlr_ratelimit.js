import rateLimit from "express-rate-limit";
import { APIResponseError } from "../../utils/responseutil.js";

export default class PublicRateLimiter {
  constructor(config, logger) {
    this.logger = logger;
    this.config = config;
    this.rateLimiters = this.#createRateLimiters();
  }

  getRateLimiters() {
    return this.rateLimiters;
  }

  #createRateLimiters() {
    const createLimiterHandler = (limitType) => {
      return (req, res) => {
        this.logger.warn(
          `${limitType} rate limit exceeded for IP: ${
            req.clientIp || req.ip
          } on route: ${req.path}`
        );
        APIResponseError(
          req,
          res,
          429,
          "RATE_LIMIT_EXCEEDED",
          `Too many requests. ${limitType} limit exceeded. Please try again later.`,
          `Too many requests. ${limitType} limit exceeded. Please try again later.`
        );
      };
    };

    const rateLimitConfig = this.config.rateLimiting;

    return {
      // ⏱️ Per-minute limiter for OTP and sensitive operations
      otpMinuteLimiter: rateLimit({
        windowMs: rateLimitConfig.otp.perMinute.windowMs,
        max: rateLimitConfig.otp.perMinute.max,
        message: "Too many OTP requests. Try after 1 min",
        handler: createLimiterHandler("OTP per-minute"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      // ⏱️ Per-hour limiter for OTP
      otpHourLimiter: rateLimit({
        windowMs: rateLimitConfig.otp.perHour.windowMs,
        max: rateLimitConfig.otp.perHour.max,
        message: "Too many OTP requests. Try after 1 hour",
        handler: createLimiterHandler("OTP per-hour"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      // ⏱️ Per-day limiter for OTP
      otpDayLimiter: rateLimit({
        windowMs: rateLimitConfig.otp.perDay.windowMs,
        max: rateLimitConfig.otp.perDay.max,
        message: "Too many OTP requests. Try after 1 day",
        handler: createLimiterHandler("OTP per-day"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      // Sign-in attempt limiters
      signinMinuteLimiter: rateLimit({
        windowMs: rateLimitConfig.signin.perMinute.windowMs,
        max: rateLimitConfig.signin.perMinute.max,
        message: "Too many sign-in attempts. Try again later.",
        handler: createLimiterHandler("Sign-in per-minute"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      signinHourLimiter: rateLimit({
        windowMs: rateLimitConfig.signin.perHour.windowMs,
        max: rateLimitConfig.signin.perHour.max,
        message: "Too many sign-in attempts. Try again later.",
        handler: createLimiterHandler("Sign-in per-hour"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      signinDayLimiter: rateLimit({
        windowMs: rateLimitConfig.signin.perDay.windowMs,
        max: rateLimitConfig.signin.perDay.max,
        message: "Too many sign-in attempts. Try again later.",
        handler: createLimiterHandler("Sign-in per-day"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      // Password reset limiters
      passwordResetMinuteLimiter: rateLimit({
        windowMs: rateLimitConfig.passwordReset.perMinute.windowMs,
        max: rateLimitConfig.passwordReset.perMinute.max,
        message: "Too many password reset requests. Try again later.",
        handler: createLimiterHandler("Password reset per-minute"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      passwordResetHourLimiter: rateLimit({
        windowMs: rateLimitConfig.passwordReset.perHour.windowMs,
        max: rateLimitConfig.passwordReset.perHour.max,
        message: "Too many password reset requests. Try again later.",
        handler: createLimiterHandler("Password reset per-hour"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      passwordResetDayLimiter: rateLimit({
        windowMs: rateLimitConfig.passwordReset.perDay.windowMs,
        max: rateLimitConfig.passwordReset.perDay.max,
        message: "Too many password reset requests. Try again later.",
        handler: createLimiterHandler("Password reset per-day"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      // Contact/validation limiters
      contactCheckLimiter: rateLimit({
        windowMs: rateLimitConfig.contactCheck.perMinute.windowMs, //define the time of window contact check per Ms
        max: rateLimitConfig.contactCheck.perMinute.max, //Per minute max limit allow 
        message: "Too many contact verification requests. Try again later.", // per minute max limit allowed 
        handler: createLimiterHandler("Contact check per-minute"), // its handle logs or alers when limit exeed
        standardHeaders: true, //send ratelimit to users on header like popup
        legacyHeaders: false, // desable the reset limit 
      }),

      // Signup/invite limiters
      signupLimiter: rateLimit({
        windowMs: rateLimitConfig.signup.perMinute.windowMs,
        max: rateLimitConfig.signup.perMinute.max,
        message: "Too many signup attempts. Try again later.",
        handler: createLimiterHandler("Signup per-minute"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      // General public API limiter
      generalLimiter: rateLimit({
        windowMs: rateLimitConfig.general.perMinute.windowMs,
        max: rateLimitConfig.general.perMinute.max,
        message: "Too many requests. Try again later.",
        handler: createLimiterHandler("General per-minute"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      // Admin/superadmin specific limiter
      adminMinuteLimiter: rateLimit({
        windowMs: rateLimitConfig.admin.perMinute.windowMs,
        max: rateLimitConfig.admin.perMinute.max,
        message: "Too many admin requests. Try again later.",
        handler: createLimiterHandler("Admin per-minute"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      adminHourLimiter: rateLimit({
        windowMs: rateLimitConfig.admin.perHour.windowMs,
        max: rateLimitConfig.admin.perHour.max,
        message: "Too many admin requests. Try again later.",
        handler: createLimiterHandler("Admin per-hour"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      testUserTokenMinuteLimiter: rateLimit({
        windowMs: rateLimitConfig.testUserToken.perMinute.windowMs,
        max: rateLimitConfig.testUserToken.perMinute.max,
        message: "Too many test user token requests. Try again later.",
        handler: createLimiterHandler("Test user token per-minute"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      testUserTokenHourLimiter: rateLimit({
        windowMs: rateLimitConfig.testUserToken.perHour.windowMs,
        max: rateLimitConfig.testUserToken.perHour.max,
        message: "Too many test user token requests. Try again later.",
        handler: createLimiterHandler("Test user token per-hour"),
        standardHeaders: true,
        legacyHeaders: false,
      }),

      testUserTokenDayLimiter: rateLimit({
        windowMs: rateLimitConfig.testUserToken.perDay.windowMs,
        max: rateLimitConfig.testUserToken.perDay.max,
        message: "Too many test user token requests. Try again later.",
        handler: createLimiterHandler("Test user token per-day"),
        standardHeaders: true,
        legacyHeaders: false,
      }),
    };
  }

  // ... existing getter methods remain the same ...
  getOTPLimiters() {
    return [
      this.rateLimiters.otpMinuteLimiter,
      this.rateLimiters.otpHourLimiter,
      this.rateLimiters.otpDayLimiter,
    ];
  }

  getSigninLimiters() {
    return [
      this.rateLimiters.signinMinuteLimiter,
      this.rateLimiters.signinHourLimiter,
      this.rateLimiters.signinDayLimiter,
    ];
  }

  getPasswordResetLimiters() {
    return [
      this.rateLimiters.passwordResetMinuteLimiter,
      this.rateLimiters.passwordResetHourLimiter,
      this.rateLimiters.passwordResetDayLimiter,
    ];
  }

  getAdminLimiters() {
    return [
      this.rateLimiters.adminMinuteLimiter,
      this.rateLimiters.adminHourLimiter,
    ];
  }

  getTestUserTokenLimiters() {
    return [
      this.rateLimiters.testUserTokenMinuteLimiter,
      this.rateLimiters.testUserTokenHourLimiter,
      this.rateLimiters.testUserTokenDayLimiter,
    ];
  }
}
