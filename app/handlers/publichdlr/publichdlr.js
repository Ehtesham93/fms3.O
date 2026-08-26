import z from "zod";
import PublicApiAuditSvc from "../../services/auditsvc/publicsvc_audit.js";
import { bindAuditToMethods } from "../../utils/auditutil.js";
import {
  COOKIE_MAX_AGE,
  REFRESH_TOKEN_EXPIRY_TIME,
  TOKEN_EXPIRY_TIME,
} from "../../utils/constant.js";
import { GetUnVerifiedClaims } from "../../utils/jwtutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../utils/responseutil.js";
import {
  validateAllInputs,
  ValidateCaptcha,
} from "../../utils/validationutil.js";
import PublicHdlrImpl from "./publichdlr_impl.js";
import PublicRateLimiter from "./publichdlr_ratelimit.js";
import { getLoggableRequest } from "../../utils/commonutil.js";

export default class PublicHdlr {
  constructor(
    userSvcI,
    authSvcI,
    fmsSvcI,
    platformSvcI,
    inMemCacheI,
    config,
    logger
  ) {
    this.userSvcI = userSvcI;
    this.authSvcI = authSvcI;
    this.fmsSvcI = fmsSvcI;
    this.platformSvcI = platformSvcI;
    this.config = config;
    this.logger = logger;
    this.inMemCacheI = inMemCacheI;
    this.publicHdlrImpl = new PublicHdlrImpl(
      userSvcI,
      authSvcI,
      fmsSvcI,
      platformSvcI,
      inMemCacheI,
      logger,
      config
    );

    this.auditSvc = new PublicApiAuditSvc(userSvcI.pgPoolI, logger);
    const methodsToAudit = [
      "GetSuperAdminToken",
      "CheckContact",
      "SignupWithInvite",
      "ValidateInvite",
      "UserEmailSignIn",
      "MobileSignIn",
      "MobileSendOtp",
      "ForgotPassword",
      "ResetPassword",
      "ValidateResetToken",
      "DeleteSession",
      "ChangePassword",
    ];

    bindAuditToMethods(this, this.auditSvc, logger, methodsToAudit);

    this.rateLimiter = new PublicRateLimiter(config, logger);
    this.limiters = this.rateLimiter.getRateLimiters();
  }

  RegisterRoutes(router) {
    router.use(this.limiters.generalLimiter);

    router.post(
      "/superadmin/token",
      ...this.rateLimiter.getAdminLimiters(),
      this.GetSuperAdminToken
    );

    router.post(
      "/contact/check",
      this.limiters.contactCheckLimiter,
      this.CheckContact
    );

    router.post(
      "/invite/signup",
      this.limiters.signupLimiter,
      this.SignupWithInvite
    );

    router.post(
      "/invite/validate",
      this.limiters.signupLimiter,
      this.ValidateInvite
    );

    router.post(
      "/email/signin",
      ...this.rateLimiter.getSigninLimiters(),
      this.UserEmailSignIn
    );
    router.post(
      "/email/mahindrasso/signin",
      ...this.rateLimiter.getSigninLimiters(),
      this.UserMahindrassoEmailSignIn
    );
    router.post(
      "/mobile/signin",
      ...this.rateLimiter.getSigninLimiters(),
      this.MobileSignIn
    );

    router.post(
      "/mobile/sendotp",
      ...this.rateLimiter.getOTPLimiters(),
      this.MobileSendOtp
    );

    router.post(
      "/mpin/signin",
      ...this.rateLimiter.getOTPLimiters(),
      this.MpinSignIn
    );

    router.post(
      "/user/forgotpassword",
      ...this.rateLimiter.getPasswordResetLimiters(),
      this.ForgotPassword
    );
    router.post(
      "/user/resetpassword",
      ...this.rateLimiter.getPasswordResetLimiters(),
      this.ResetPassword
    );
    router.post(
      "/user/resetpassword/validate",
      this.limiters.passwordResetMinuteLimiter,
      this.ValidateResetToken
    );

    router.delete("/user/session", this.DeleteSession);

    router.post("/user/password/change", this.ChangePassword);

    router.post(
      "/gettestusertoken",
      ...this.rateLimiter.getTestUserTokenLimiters(),
      this.GetTestUserToken
    );
  }

  handleError = (error, req, res, defaultErrorCode, defaultMessage) => {
    try {
      let reqLog = getLoggableRequest(req);
      this.logger.error(
        `API Error: ${error?.stack || error?.message || error}`,
        reqLog
      );

      if (
        error.errcode === "INPUT_ERROR" ||
        error.errcode === "CAPTCHA_FAILED" ||
        error.errcode === "RATE_LIMIT_EXCEEDED" ||
        error.errcode === "TOO_MANY_OTP_REQUESTS" ||
        error.errcode === "SMS_SEND_FAILED" ||
        error.errcode === "INVALID_MOBILE" ||
        error.errcode === "USER_NOT_FOUND"
      ) {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata || {},
          error.message
        );
      }

      if (error.errcode === "RATE_LIMIT_EXCEEDED") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          {},
          error.message
        );
      }

      const userFriendlyErrors = {
        USER_NOT_FOUND: {
          code: "USER_NOT_FOUND",
          message: "User with this contact doesn't exist",
        },
        INVALID_CREDENTIALS: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
        INVALID_OTP: {
          code: "INVALID_OTP",
          message: "Invalid OTP",
        },
        INVALID_MPIN: {
          code: "INVALID_MPIN",
          message: "Invalid MPIN",
        },
        ACCOUNT_DISABLED: {
          code: "ACCOUNT_DISABLED",
          message: "Account is disabled",
        },
        ACCOUNT_DELETED: {
          code: "ACCOUNT_DELETED",
          message: "Account is deleted",
        },
        USER_IS_NOT_SUPERADMIN: {
          code: "USER_IS_NOT_SUPERADMIN",
          message:
            "You don't have the required permissions to access this resource.",
        },
        MPIN_NOT_SET: {
          code: "MPIN_NOT_SET",
          message: "MPIN is not set for this account",
        },
        MPIN_DISABLED: {
          code: "MPIN_DISABLED",
          message: "MPIN authentication is disabled for this account",
        },
        INVALID_RESET_TOKEN: {
          code: "INVALID_RESET_TOKEN",
          message: "Password reset link is invalid or has expired",
        },
        RESET_TOKEN_EXPIRED: {
          code: "RESET_TOKEN_EXPIRED",
          message: "Password reset link has expired",
        },
        RESET_TOKEN_USED: {
          code: "RESET_TOKEN_USED",
          message: "Password reset link has already been used",
        },
        SIGNUP_FAILED: {
          code: "SIGNUP_FAILED",
          message: "Failed to signup with invite",
        },
        AUTH_SERVICE_ERROR: {
          code: "AUTH_SERVICE_ERROR",
          message: "Failed to create user in auth service",
        },
        EMAIL_NOT_FOUND: {
          code: "EMAIL_NOT_FOUND",
          message: "User with this email doesn't exist",
        },
        PASSWORD_SAME_AS_OLD: {
          code: "PASSWORD_SAME_AS_OLD",
          message: "New password cannot be the same as the old password",
        },
        PASSWORD_EXPIRED: {
          code: "PASSWORD_EXPIRED",
          message:
            "Your password has expired. Please reset your password to continue.",
        },
      };

      const errorMessage = error.message || error.toString();

      if (errorMessage.startsWith("ACCOUNT_LOCKED:")) {
        const remainingTime = errorMessage.split(":")[1];
        return APIResponseBadRequest(
          req,
          res,
          "ACCOUNT_LOCKED",
          { remainingTimeMinutes: parseInt(remainingTime) },
          `Account temporarily locked due to multiple unsuccessful login attempts. Try Again in ${remainingTime} minutes.`
        );
      }

      const friendlyError = userFriendlyErrors[errorMessage];

      if (friendlyError) {
        return APIResponseBadRequest(
          req,
          res,
          friendlyError.code,
          {},
          friendlyError.message
        );
      }

      return APIResponseInternalErr(
        req,
        res,
        defaultErrorCode,
        {},
        defaultMessage
      );
    } catch (error) {
      console.error("PublicHdlr::handleError::error: ", error);
    }
  };

  ExtractOptionalUserIdFromToken = async (req) => {
    try {
      let token = req.headers["Cookie"] || req.headers["cookie"];

      if (!token) {
        token = req.headers["Authorization"] || req.headers["authorization"];
        if (token && token.startsWith("Bearer ")) {
          token = token.substring(7);
        }
      } else {
        if (token.includes(";")) {
          let cookies = token.split(";");
          for (let eachcookie of cookies) {
            eachcookie = eachcookie.trim();
            if (eachcookie.startsWith("token=")) {
              token = eachcookie.substring(6);
              break;
            }
          }
        }

        if (token.startsWith("token=")) {
          token = token.substring(6);
        }
      }

      if (!token) {
        return null;
      }

      let claims = await GetUnVerifiedClaims(token);
      if (!claims || !claims.userid) {
        return null;
      }

      return claims.userid;
    } catch (error) {
      this.logger.error("ExtractOptionalUserIdFromToken error: ", error);
      return null;
    }
  };

  CheckContact = async (req, res, next) => { // its handle api req & res and pass control to next middleware 
    try {
      const captchaToken = req.body["g-recaptcha-response"]; //catch captchaToken error 
      const remoteIp = req.ip;
      const referer = req.headers.referer;
      let inviteid = null;
      if(referer){
          inviteid = referer.split("?inviteid=").pop();
          if(inviteid){
            const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
            if(uuidRegex.test(inviteid)){
              inviteid = inviteid;
            }else{
              inviteid = null;
            }
          }
      }

      // if (captchaToken) { //check is captchaToken is valid ??
      //   const isValidCaptcha = await ValidateCaptcha(
      //     captchaToken,
      //     remoteIp,
      //     this.config
      //   );

      //   if (!isValidCaptcha) { //if captcha is not valid then through the error CAPTCHA failed 
      //       errcode: "CAPTCHA_FAILED",
      //       errdata: {},
      //       message: "Security verification failed. Please try again.",
      //     };
      //   }
      // }

      let schema = z.object({ //create a validation schema using ZOD z.object
        contact: z
          .string({ // contact must be string
            message: "Please provide a valid contact (email or mobile number)",
          })
          .nonempty({ message: "Contact information is required" }) //can not be empty
          .max(128, { // it can be maximum 128 character
            message: "Contact must be at most 128 characters long",
          }),
      });

      let { contact } = validateAllInputs(schema, { // validate the contact field from the req body if invalid throw error
        contact: req.body.contact,
      });

      let result = await this.publicHdlrImpl.CheckContactLogic(contact);
      APIResponseOK(req, res, result, "Contact verified successfully");
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "CHECK_CONTACT_ERR", //Sends error response with code "CHECK_CONTACT_ERR" and message "User with this contact doesn't exist".
        "User with this contact doesn't exist"
      );
    }
  };

  MobileSendOtp = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;

      if (captchaToken) {
        const isValidCaptcha = await ValidateCaptcha(
          captchaToken,
          remoteIp,
          this.config
        );

        if (!isValidCaptcha) {
          throw {
            errcode: "CAPTCHA_FAILED",
            errdata: {},
            message: "Security verification failed. Please try again.",
          };
        }
      }

      let schema = z.object({
        mobile: z
          .string({ message: "Please provide a valid mobile number" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          }),
      });

      let { mobile } = validateAllInputs(schema, {
        mobile: req.body.mobile,
      });

      let result = await this.publicHdlrImpl.MobileSendOtpLogic(mobile, req);
      APIResponseOK(
        req,
        res,
        result,
        "OTP sent successfully to your mobile number"
      );
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "MOBILE_SEND_OTP_ERR",
        "We couldn't send the OTP to your mobile number. Please try again."
      );
    }
  };

  MobileSignIn = async (req, res, next) => {
    try {
      let schema = z.object({
        mobile: z
          .string({ message: "Please provide a valid mobile number" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          }),
        otp: z
          .string({ message: "Invalid OTP format" })
          .nonempty({ message: "OTP cannot be empty" }),
      });

      let { mobile, otp } = validateAllInputs(schema, {
        mobile: req.body.mobile,
        otp: req.body.otp,
      });

      let validityMs = req.body.validity;
      let expiresin = TOKEN_EXPIRY_TIME;
      let refreshTokenMaxAge = REFRESH_TOKEN_EXPIRY_TIME;

      // // TODO: Add mobile number for which we want different expiry time
      // if (mobile == "9742720873" || mobile == "7795772862") {
      //   expiresin = 30;
      // }

      if (validityMs) {
        expiresin = Math.floor(validityMs / 1000);
      }

      let result = await this.publicHdlrImpl.MobileSignInLogic(
        mobile,
        otp,
        expiresin,
        refreshTokenMaxAge,
        req
      );
      res.cookie("token", result.usertoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });
      res.cookie("refreshtoken", result.refreshtoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(
        req,
        res,
        result,
        "Successfully signed in with your mobile number"
      );
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "MOBILE_SIGN_IN_ERR",
        "We couldn't sign you in. Invalid OTP."
      );
    }
  };

  GetSuperAdminToken = async (req, res, next) => {
    try {
      let schema = z.object({
        email: z
          .string({ message: "Please provide a valid email address" })
          .email({ message: "Please provide a valid email format" }),
        password: z
          .string({ message: "Password is required" })
          .nonempty({ message: "Password cannot be empty" })
          .min(8, { message: "Password must be at least 8 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
      });

      let { email, password } = validateAllInputs(schema, {
        email: req.body.email,
        password: req.body.password,
      });

      let validityMs = req.body.validity;
      let expiresin = TOKEN_EXPIRY_TIME;
      let refreshTokenMaxAge = REFRESH_TOKEN_EXPIRY_TIME;

      if (validityMs) {
        expiresin = Math.floor(validityMs / 1000);
      }

      let result = await this.publicHdlrImpl.GetSuperAdminTokenLogic(
        email,
        password,
        expiresin,
        refreshTokenMaxAge
      );
      res.cookie("token", result.token, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });
      res.cookie("refreshtoken", result.refreshtoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(req, res, result, "Admin access granted successfully");
    } catch (error) {
      if (error.message === "USER_IS_NOT_SUPERADMIN") {
        return APIResponseForbidden(
          req,
          res,
          "USER_IS_NOT_SUPERADMIN",
          {},
          "You don't have the required permissions to access this resource."
        );
      }

      return this.handleError(
        error,
        req,
        res,
        "GET_SUPER_ADMIN_TOKEN_ERR",
        "We couldn't verify your admin credentials. Please check your details and try again."
      );
    }
  };

  UserEmailSignIn = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;

      // if (captchaToken) {
      //   const isValidCaptcha = await ValidateCaptcha(
      //     captchaToken,
      //     remoteIp,
      //     this.config
      //   );

      //   if (!isValidCaptcha) {
      //     throw {
      //       errcode: "CAPTCHA_FAILED",
      //       errdata: {},
      //       message: "Security verification failed. Please try again.",
      //     };
      //   }
      // }

      let schema = z.object({
        email: z
          .string({ message: "Please provide a valid email address" })
          .email({ message: "Please provide a valid email format" }),
        password: z
          .string({ message: "Password is required" })
          .nonempty({ message: "Password cannot be empty" })
          .min(8, { message: "Password must be at least 8 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
      });

      let { email, password } = validateAllInputs(schema, {
        email: req.body.email,
        password: req.body.password,
      });

      let validity = req.body.validity;
      let expiresin = TOKEN_EXPIRY_TIME;
      let refreshTokenMaxAge = REFRESH_TOKEN_EXPIRY_TIME;

      if (validity && Array.isArray(validity) && validity.length >= 2) {
        expiresin = Math.floor(validity[0] / 1000);
        refreshTokenMaxAge = validity[1];
      } else if (validity && !Array.isArray(validity)) {
        expiresin = Math.floor(validity / 1000);
      }

      let result = await this.publicHdlrImpl.UserEmailSignInLogic(
        email,
        password,
        expiresin,
        refreshTokenMaxAge
      );
      res.cookie("token", result.token, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });
      res.cookie("refreshtoken", result.refreshtoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(req, res, result, "Successfully signed in with your email");
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "USER_EMAIL_SIGN_IN_ERR",
        "We couldn't sign you in. Invalid email or password."
      );
    }
  };

  UserMahindrassoEmailSignIn = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;
      const referer = req.headers.referer;
      let inviteid = null;
      if(referer){
          inviteid = referer.split("?inviteid=").pop();
          if(inviteid){
            const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
            if(uuidRegex.test(inviteid)){
              inviteid = inviteid;
            }else{
              inviteid = null;
            }
          }
      }


      if (captchaToken) {
        const isValidCaptcha = await ValidateCaptcha(
          captchaToken,
          remoteIp,
          this.config
        );

        if (!isValidCaptcha) {
          throw {
            errcode: "CAPTCHA_FAILED",
            errdata: {},
            message: "Security verification failed. Please try again.",
          };
        }
      }

      let schema = z.object({
        email: z
          .string({ message: "Please provide a valid email address" })
          .email({ message: "Please provide a valid email format" }),
        authtoken: z
          .string({ message: "Please provide a valid authentication token" })
          .nonempty({ message: "Authentication token cannot be empty" }),
      });

      let { email, authtoken } = validateAllInputs(schema, {
        email: req.body.email,
        authtoken: req.body.authtoken,
      });

      let validity = req.body.validity;
      let expiresin = TOKEN_EXPIRY_TIME;
      let refreshTokenMaxAge = REFRESH_TOKEN_EXPIRY_TIME;

      if (validity && Array.isArray(validity) && validity.length >= 2) {
        expiresin = Math.floor(validity[0] / 1000);
        refreshTokenMaxAge = validity[1];
      } else if (validity && !Array.isArray(validity)) {
        expiresin = Math.floor(validity / 1000);
      }

      let result = await this.publicHdlrImpl.UserMahindrassoEmailSignInLogic(
        email,
        authtoken,
        expiresin,
        refreshTokenMaxAge,
        inviteid
      );
      res.cookie("token", result.token, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });
      res.cookie("refreshtoken", result.refreshtoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(req, res, result, "Successfully signed in with your email");
    } catch (error) {
      if (error.errcode === "INVALID_CREDENTIALS") {
        return APIResponseForbidden(
          req,
          res,
          "INVALID_CREDENTIALS",
          {},
          "Invalid credentials"
        );
      }else if (error.errcode === "USER_NOT_REGISTERED") {
        return APIResponseForbidden(
          req,
          res,
          "USER_NOT_REGISTERED",
          {},
          "User is not registered"
        );
      } else if (error.errcode === "USER_NOT_FOUND") {
        return APIResponseForbidden(
          req,
          res,
          "USER_NOT_FOUND",
          {},
          "User not found"
        );
      }else if (error.errcode === "ACCOUNT_LOCKED") {
        return APIResponseForbidden(
          req,
          res,
          "ACCOUNT_LOCKED",
          {},
          "Account locked"
        );
      }else if (error.errcode === "ACCOUNT_DISABLED") {
        return APIResponseForbidden(
          req,
          res,
          "ACCOUNT_DISABLED",
          {},
          "Account is disabled"
        );
      }else if (error.errcode === "ACCOUNT_DELETED") {
        return APIResponseForbidden(
          req,
          res,
          "ACCOUNT_DELETED",
          {},
          "Account is deleted"
        );
      } else if (error.errcode === "TOKEN_EXPIRED") {
        return APIResponseForbidden(
          req,
          res,
          "TOKEN_EXPIRED",
          {},
          "Token expired"
        );
      } else {
        return this.handleError(
          error,
          req,
          res,
          "USER_EMAIL_SIGN_IN_ERR",
          "We couldn't sign you in. Invalid email or password."
        );
      }
    }
  };

  GetTestUserToken = async (req, res, next) => {
    try {
      let schema = z.object({
        email: z
          .string({ message: "Please provide a valid email address" })
          .email({ message: "Please provide a valid email format" }),
        password: z
          .string({ message: "Password is required" })
          .nonempty({ message: "Password cannot be empty" })
          .min(8, { message: "Password must be at least 8 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
      });

      let { email, password } = validateAllInputs(schema, {
        email: req.body.email,
        password: req.body.password,
      });

      let expiresin = TOKEN_EXPIRY_TIME;
      let refreshTokenMaxAge = REFRESH_TOKEN_EXPIRY_TIME;

      let result = await this.publicHdlrImpl.GetTestUserTokenLogic(
        email,
        password,
        expiresin,
        refreshTokenMaxAge
      );
      res.cookie("token", result.token, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });
      res.cookie("refreshtoken", result.refreshtoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(req, res, result, "Successfully signed in with your email");
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "USER_EMAIL_SIGN_IN_ERR",
        "We couldn't sign you in. Invalid email or password."
      );
    }
  };

  SignupWithInvite = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;

      // if (!captchaToken) {
      //   return APIResponseBadRequest(
      //     req,
      //     res,
      //     "CAPTCHA_MISSING",
      //     {},
      //     "Please complete the security verification to continue."
      //   );
      // }

      // const isValidCaptcha = await ValidateCaptcha(
      //   captchaToken,
      //   remoteIp,
      //   this.config
      // );

      // if (!isValidCaptcha) {
      //   return APIResponseBadRequest(
      //     req,
      //     res,
      //     "CAPTCHA_FAILED",
      //     {},
      //     "Security verification failed. Please try again."
      //   );
      // }

      let schema = z.object({
        inviteid: z
          .string({ message: "Invite ID is required" })
          .uuid({ message: "Please provide a valid invite link" }),
        password: z
          .string({ message: "Password is required" })
          .nonempty({ message: "Password cannot be empty" })
          .min(8, { message: "Password must be at least 8 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
        displayname: z
          .string({ message: "Display name is required" })
          .nonempty({ message: "Display name cannot be empty" })
          .max(128, {
            message: "Display name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Display name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });

      let { inviteid, password, displayname } = validateAllInputs(
        schema,
        req.body
      );

      let result = await this.publicHdlrImpl.SignupWithInviteLogic(
        inviteid,
        displayname,
        password
      );
      res.cookie("token", result.token, {
        httpOnly: true,
        secure: true,
        maxAge: 1000 * 60 * 60 * 24 * 31, // 31 day
        path: "/",
        sameSite: "None",
      });
      res.cookie("refreshtoken", result.refreshtoken, {
        httpOnly: true,
        secure: true,
        maxAge: 1000 * 60 * 60 * 24 * 31, // 31 days
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(
        req,
        res,
        result,
        "Welcome! Your account has been created successfully"
      );
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "SIGNUP_WITH_INVITE_ERR",
        "We couldn't create your account. Please check your invite link and try again."
      );
    }
  };

  // Note: this is not used in frontend
  ValidateInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        inviteid: z
          .string({ message: "Invite ID is required" })
          .uuid({ message: "Please provide a valid invite link" }),
      });

      let { inviteid } = validateAllInputs(schema, {
        inviteid: req.body.inviteid,
      });

      let userid = await this.ExtractOptionalUserIdFromToken(req);

      let result = await this.publicHdlrImpl.ValidateInviteLogic(
        inviteid,
        userid
      );
      if(result.isvalid){
        return APIResponseOK(req, res, result, "Invite link is valid and ready to use");
      }else{
        return APIResponseBadRequest(
          req,
          res,
          "INVALID_INVITE_LINK",
          {},
          "Invalid invite link"
        );
      }
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "VALIDATE_INVITE_ERR",
        "This invite link is invalid or has expired. Please request a new invitation."
      );
    }
  };

  ForgotPassword = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;

      if (captchaToken) {
        const isValidCaptcha = await ValidateCaptcha(
          captchaToken,
          remoteIp,
          this.config
        );

        if (!isValidCaptcha) {
          throw {
            errcode: "CAPTCHA_FAILED",
            errdata: {},
            message: "Security verification failed. Please try again.",
          };
        }
      }

      let schema = z.object({
        email: z
          .string()
          .email({ message: "Please provide a valid email address" }),
      });

      let { email } = validateAllInputs(schema, {
        email: req.body.email,
      });

      const headerReferer = req.headers.origin;

      if (!headerReferer) {
        return APIResponseBadRequest(
          req,
          res,
          "HEADER_REFERER_MISSING",
          {},
          "Invalid request source. Please try again from the application."
        );
      }

      let result = await this.publicHdlrImpl.ForgotPasswordLogic(
        email,
        headerReferer
      );
      APIResponseOK(
        req,
        res,
        result,
        "Password reset instructions have been sent to your email"
      );
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "FORGOT_PASSWORD_ERR",
        "We couldn't process your password reset request. Please try again."
      );
    }
  };

  ResetPassword = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;

      // TODO: Remove this once we have a proper captcha implementation
      // if (captchaToken) {
      if (!captchaToken) {
        return APIResponseBadRequest(
          req,
          res,
          "CAPTCHA_MISSING",
          {},
          "Please complete the security verification to continue."
        );
      }

      const isValidCaptcha = await ValidateCaptcha(
        captchaToken,
        remoteIp,
        this.config
      );

      if (!isValidCaptcha) {
        return APIResponseBadRequest(
          req,
          res,
          "CAPTCHA_FAILED",
          {},
          "Security verification failed. Please try again."
        );
      }
      // }

      let schema = z.object({
        resetid: z
          .string({ message: "Reset token is required" })
          .uuid({ message: "Invalid password reset link" }),
        newpassword: z
          .string({ message: "New password is required" })
          .nonempty({ message: "New password cannot be empty" })
          .min(8, { message: "Password must be at least 8 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
      });

      let { resetid, newpassword } = validateAllInputs(schema, {
        resetid: req.body.resetid,
        newpassword: req.body.newpassword,
      });

      let result = await this.publicHdlrImpl.ResetPasswordLogic(
        resetid,
        newpassword
      );
      APIResponseOK(
        req,
        res,
        result,
        "Your password has been reset successfully"
      );
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "RESET_PASSWORD_ERR",
        "We couldn't reset your password. Please try requesting a new reset link."
      );
    }
  };

  ValidateResetToken = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;

      if (captchaToken) {
        const isValidCaptcha = await ValidateCaptcha(
          captchaToken,
          remoteIp,
          this.config
        );

        if (!isValidCaptcha) {
          throw {
            errcode: "CAPTCHA_FAILED",
            errdata: {},
            message: "Security verification failed. Please try again.",
          };
        }
      }

      let schema = z.object({
        resetid: z
          .string({ message: "Reset token is required" })
          .uuid({ message: "Invalid password reset link" }),
      });

      let { resetid } = validateAllInputs(schema, {
        resetid: req.body.resetid,
      });

      const userid = await this.ExtractOptionalUserIdFromToken(req);

      let result = await this.publicHdlrImpl.ValidateResetTokenLogic(
        resetid,
        userid
      );
      APIResponseOK(req, res, result, result.message);
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "VALIDATE_RESET_TOKEN_ERR",
        "This password reset link is invalid or has expired. Please request a new one."
      );
    }
  };

  DeleteSession = async (req, res, next) => {
    try {
      res.clearCookie("token");
      APIResponseOK(req, res, {}, "You have been signed out successfully");
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "DELETE_SESSION_ERR",
        "We couldn't sign you out properly. Please try again."
      );
    }
  };

  MpinSignIn = async (req, res, next) => {
    try {
      let schema = z.object({
        mobile: z
          .string({ message: "Please provide a valid mobile number" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          }),
        mpin: z
          .string({ message: "MPIN is required" })
          .nonempty({ message: "Please enter your MPIN" }),
      });

      let { mobile, mpin } = validateAllInputs(schema, {
        mobile: req.body.mobile,
        mpin: req.body.mpin,
      });

      let validityMs = req.body.validity;
      let expiresin = TOKEN_EXPIRY_TIME;
      let refreshTokenMaxAge = REFRESH_TOKEN_EXPIRY_TIME;

      if (mobile == "8814010926" || mobile == "7795772862") {
        expiresin = 30;
      }

      if (validityMs) {
        expiresin = Math.floor(validityMs / 1000);
      }

      let result = await this.publicHdlrImpl.MpinSignInLogic(
        mobile,
        mpin,
        expiresin,
        refreshTokenMaxAge
      );
      res.cookie("token", result.usertoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });
      res.cookie("refreshtoken", result.refreshtoken, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(req, res, result, "Successfully signed in with your MPIN");
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "MPIN_SIGN_IN_ERR",
        "We couldn't sign you in. Invalid MPIN."
      );
    }
  };

  ChangePassword = async (req, res, next) => {
    try {
      const captchaToken = req.body["g-recaptcha-response"];
      const remoteIp = req.ip;

      if (!captchaToken) {
        throw {
          errcode: "CAPTCHA_MISSING",
          errdata: {},
          message: "Please complete the security verification to continue.",
        };
      }

      const isValidCaptcha = await ValidateCaptcha(
        captchaToken,
        remoteIp,
        this.config
      );

      if (!isValidCaptcha) {
        throw {
          errcode: "CAPTCHA_FAILED",
          errdata: {},
          message: "Security verification failed. Please try again.",
        };
      }

      let schema = z.object({
        email: z
          .string({ message: "Please provide a valid email address" })
          .email({ message: "Please provide a valid email format" }),
        oldpassword: z
          .string({ message: "Current password is required" })
          .nonempty({ message: "Current password cannot be empty" }),
        newpassword: z
          .string({ message: "New password is required" })
          .nonempty({ message: "New password cannot be empty" }),
      });

      let { email, oldpassword, newpassword } = validateAllInputs(schema, {
        email: req.body.email,
        oldpassword: req.body.oldpassword,
        newpassword: req.body.newpassword,
      });

      let result = await this.publicHdlrImpl.ChangePasswordLogic(
        email,
        oldpassword,
        newpassword
      );
      APIResponseOK(
        req,
        res,
        result,
        "Your password has been changed successfully"
      );
    } catch (error) {
      return this.handleError(
        error,
        req,
        res,
        "CHANGE_PASSWORD_ERR",
        "We couldn't change your password."
      );
    }
  };
}
