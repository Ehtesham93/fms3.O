import crypto from "crypto";
import promiserouter from "express-promise-router";
import z from "zod";
import {
  APIResponseBadRequest,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../utils/responseutil.js";
import { AuthenticateUserTokenFromCookie } from "../../utils/tokenutil.js";
import { validateAllInputs } from "../../utils/validationutil.js";
import UserHdlrImpl from "./userhdlr_impl.js";
import { TOKEN_EXPIRY_TIME, COOKIE_MAX_AGE } from "../../utils/constant.js";
import { Sleep } from "../../utils/commonutil.js";

export default class UserHdlr {
  /**
   * @param {UserSvc} userSvcI
   * @param {AuthSvc} authSvcI
   * @param {Logger} logger
   */
  constructor(userSvcI, authSvcI, fmsSvcI, platformSvcI, config, logger) {
    this.userSvcI = userSvcI;
    this.authSvcI = authSvcI;
    this.logger = logger;
    this.config = config;
    this.userHdlrImpl = new UserHdlrImpl(
      userSvcI,
      authSvcI,
      fmsSvcI,
      platformSvcI,
      logger
    );
  }

  RegisterRoutes(router) {
    const userTokenGroup = promiserouter();

    userTokenGroup.use(AuthenticateUserTokenFromCookie);

    router.use("/", userTokenGroup);
    userTokenGroup.get("/home", this.GetHomePage);
    userTokenGroup.post("/invite/accept", this.AcceptInvite);
    userTokenGroup.post("/invite/reject", this.RejectInvite);
    userTokenGroup.get("/accounts", this.GetUserAccounts);

    // Feedback / Rating APIs
    userTokenGroup.get("/feedback/status", this.GetUserFeedbackStatus);
    userTokenGroup.post("/feedback/:type", this.PostUserFeedback);

    userTokenGroup.get("/invites", this.ListInvitesOfUser);
    userTokenGroup.get("/account/:accountid/token", this.GetAccountToken);
    userTokenGroup.put("/displayname", this.UpdateDisplayName);
    userTokenGroup.post("/logout", this.Logout);
    userTokenGroup.get("/csrftoken", this.GetCSRFToken);

    userTokenGroup.put("/setdefaults", this.SetDefaults);
    userTokenGroup.get("/info", this.GetUserInfo);
    userTokenGroup.post("/:userid/recover", this.RecoverUser);

    userTokenGroup.post("/addmobile", this.AddUserMobile);
    userTokenGroup.post("/addmobile/verify", this.VerifyAddMobileOtp);

    userTokenGroup.post("/addemail", this.AddUserEmail);
    userTokenGroup.get("/addemail/validate", this.ValidateAddEmailVerification);
    userTokenGroup.post("/addemail/verify", this.VerifyEmailPwd);
    userTokenGroup.get("/acceptedterms", this.GetAcceptedTerms);
    userTokenGroup.put("/acceptedterms", this.PutAcceptedTerms);
    userTokenGroup.get("/soscontacts", this.GetSosContacts);
    userTokenGroup.get("/documents", this.GetDocuments);
    userTokenGroup.get("/banners", this.GetBanners);

    userTokenGroup.post("/setmpin", this.SetMpin);

    userTokenGroup.post("/refreshtoken", this.RefreshToken);
    userTokenGroup.post("/updatepassword", this.UpdatePassword);
  }

  AcceptInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        inviteid: z
          .string({ message: "Invalid Invite ID format" })
          .uuid({ message: "Invite ID must be a valid UUID" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      let { inviteid, userid } = validateAllInputs(schema, {
        inviteid: req.body.inviteid,
        userid: req.userid,
      });

      let result = await this.userHdlrImpl.AcceptInviteLogic(inviteid, userid);

      APIResponseOK(req, res, result, "Invite accepted successfully");
    } catch (e) {
      this.logger.error("AcceptInvite error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "INVALID_INVITE_ID" ||
        e.errcode === "INVITE_NOT_IN_SENT_STATE" ||
        e.errcode === "INVITE_NOT_AN_EMAIL_INVITE" ||
        e.errcode === "INVITE_HAS_EXPIRED" ||
        e.errcode === "USER_NOT_FOUND" ||
        e.errcode === "USER_ID_DOES_NOT_MATCH" ||
        e.errcode === "FAILED_TO_UPDATE_INVITE_STATUS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "ACCEPT_INVITE_ERR",
          e.toString(),
          "Accept invite failed"
        );
      }
    }
  };

  RejectInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        inviteid: z
          .string({ message: "Invite ID is required" })
          .uuid({ message: "Invite ID must be a valid UUID" }),
        userid: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });
      let { inviteid, userid } = validateAllInputs(schema, {
        inviteid: req.body.inviteid,
        userid: req.userid,
      });
      let result = await this.userHdlrImpl.RejectInviteLogic(inviteid, userid);
      APIResponseOK(req, res, result, "Invite rejected successfully");
    } catch (e) {
      this.logger.error("RejectInvite error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "INVALID_INVITE_ID" ||
        e.errcode === "INVITE_NOT_IN_SENT_STATE" ||
        e.errcode === "INVITE_NOT_AN_EMAIL_INVITE" ||
        e.errcode === "INVITE_HAS_EXPIRED" ||
        e.errcode === "USER_NOT_FOUND" ||
        e.errcode === "USER_ID_DOES_NOT_MATCH" ||
        e.errcode === "FAILED_TO_UPDATE_INVITE_STATUS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "REJECT_INVITE_ERR",
          e.toString(),
          "Reject invite failed"
        );
      }
    }
  };

  GetHomePage = async (req, res, next) => {
    try {
      let userid = req.userid;
      let result = await this.userHdlrImpl.GetHomePageLogic(userid);
      APIResponseOK(req, res, result, "Home page fetched successfully");
    } catch (e) {
      this.logger.error("GetHomePage error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "GET_HOME_PAGE_ERR",
        e.toString(),
        "Get home page failed"
      );
    }
  };

  GetUserAccounts = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
      });
      let { userid } = validateAllInputs(schema, {
        userid: req.userid,
      });
      let result = await this.userHdlrImpl.GetUserAccountsLogic(userid);
      APIResponseOK(req, res, result, "User Accounts fetched successfully");
    } catch (error) {
      this.logger.error("GetUserAccounts error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_USER_ACCOUNTS_ERR",
          error.toString(),
          "Get user accounts failed"
        );
      }
    }
  };

  GetUserFeedbackStatus = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.userid,
      });

      let result = await this.userHdlrImpl.GetUserFeedbackStatusLogic(userid);

      APIResponseOK(req, res, result, "Feedback status fetched successfully");
    } catch (e) {
      this.logger.error("GetUserFeedbackStatus error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "GET_USER_FEEDBACK_STATUS_ERR",
          e.toString(),
          "Get user feedback status failed"
        );
      }
    }
  };

  PostUserFeedback = async (req, res, next) => {
    try {
      const schema = z
        .object({
          userid: z
            .string({ message: "User ID is required" })
            .uuid({ message: "Invalid User ID format" }),

          type: z
            .string({ message: "Feedback type is required" })
            .trim()
            .min(1, { message: "Feedback type is required" })
            .max(50, { message: "Feedback type must be at most 50 characters" })
            .regex(/^[a-zA-Z_]+$/, {
              message:
                "Feedback type can only contain letters and underscores",
            }),

          comments: z
            .string({ message: "Comments must be a string" })
            .max(1000, { message: "Comments must be at most 1000 characters" })
            .optional()
            .nullable(),

          platform: z
            .string({ message: "Platform must be a string" })
            .max(50, { message: "Platform must be at most 50 characters" })
            .optional()
            .nullable(),

          rating: z
            .union([
              z.string().regex(/^[0-5]$/, {
                message:
                  "Rating must be a string value between 0 and 5 for ratings",
              }),
              z.null(),
              z.undefined(),
            ])
            .optional(),

          app_version: z
            .string({ message: "App version must be a string" })
            .max(50, { message: "App version must be at most 50 characters" })
            .optional()
            .nullable(),

          build_number: z
            .string({ message: "Build number must be a string" })
            .max(50, { message: "Build number must be at most 50 characters" })
            .optional()
            .nullable(),

          app_name: z
            .string({ message: "App name must be a string" })
            .max(100, { message: "App name must be at most 100 characters" })
            .optional()
            .nullable(),
        })
        .superRefine((data, ctx) => {
          const normalizedType = data.type?.toLowerCase();

          if (normalizedType === "ratings") {
            if (
              data.rating === undefined ||
              data.rating === null ||
              data.rating === ""
            ) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["rating"],
                message:
                  "Rating is required for ratings and must be between 0 and 5",
              });
            }
          }
        });

      let {
        userid,
        type,
        comments,
        platform,
        rating,
        app_version,
        build_number,
        app_name,
      } = validateAllInputs(schema, {
        userid: req.userid,
        type: req.params.type,
        comments: req.body.comments,
        platform: req.body.platform,
        rating: req.body.rating,
        app_version: req.body.app_version,
        build_number: req.body.build_number,
        app_name: req.body.app_name ?? "Nemo3.0",
      });

      let payload = {
        comments: comments ?? null,
        platform: platform ?? null,
        rating: rating ?? null,
        app_version: app_version ?? null,
        build_number: build_number ?? null,
        app_name: app_name ?? "Nemo3.0",
      };

      let result = await this.userHdlrImpl.AddUserFeedbackLogic(
        userid,
        type,
        payload
      );

      APIResponseOK(req, res, result, "Thank you for your feedback !");
    } catch (e) {
      this.logger.error("PostUserFeedback error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "INVALID_FEEDBACK_TYPE" ||
        e.errcode === "INVALID_RATING" ||
        e.errcode === "INVALID_RATING_REFERENCE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "POST_USER_FEEDBACK_ERR",
          e.toString(),
          "Post user feedback failed"
        );
      }
    }
  };

  GetAccountToken = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { userid, accountid } = validateAllInputs(schema, {
        userid: req.userid,
        accountid: req.params.accountid,
      });

      let validityMs = req.body.validity;
      let expiresin = TOKEN_EXPIRY_TIME;

      if (
        userid === "45f49d41-1180-4fd2-9e24-ae09c18f0f52" ||
        userid === "7c8a6d0c-5878-4774-b678-1c779afdb4c5"
      ) {
        expiresin = 30;
      }

      if (validityMs) {
        expiresin = Math.floor(validityMs / 1000);
      }

      let result = await this.userHdlrImpl.GetAccountTokenLogic(
        userid,
        accountid,
        expiresin
      );
      res.cookie("token", result.accounttoken, {
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
        "User Account token fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetAccountToken error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (error.message === "ACCOUNT_NOT_FOUND") {
        APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Account not found or not enabled"
        );
      } else if (error.message === "USER_HAS_NO_ACCOUNT_ACCESS") {
        APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "User has no account access"
        );
      } else if (error.message === "USER_DOES_NOT_HAVE_ACCESS_TO_ACCOUNT") {
        APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "User does not have access to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_TOKEN_ERR",
          error.toString(),
          "Get account token failed"
        );
      }
    }
  };

  Logout = async (req, res, next) => {
    try {
      let userid = req.userid;
      let result = await this.userHdlrImpl.LogoutLogic(userid);
      res.clearCookie("token");
      res.clearCookie("refreshtoken");
      APIResponseOK(req, res, result, "Logout successful");
    } catch (error) {
      this.logger.error("Logout error: ", error);
      res.clearCookie("token");
      res.clearCookie("refreshtoken");
      this.logger.error("error while logging out", error);

      APIResponseOK(
        req,
        res,
        { err: "Token Invalidation Pending" },
        "Logout successful"
      );
    }
  };

  GetCSRFToken = async (req, res, next) => {
    try {
      let csrfToken = req.csrfToken();
      let expiresAt = new Date(
        Date.now() + (this.config.csrf.maxAgeInSeconds - 300) * 1000
      );
      APIResponseOK(
        req,
        res,
        { csrfToken, expiresAt },
        "CSRF token fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetCSRFToken error: ", error);
      APIResponseInternalErr(
        req,
        res,
        "GET_CSRF_TOKEN_ERR",
        error.toString(),
        "Get CSRF token failed"
      );
    }
  };

  UpdateDisplayName = async (req, res, next) => {
    try {
      let schema = z.object({
        displayname: z
          .string({ message: "Display name is required" })
          .nonempty({ message: "Display name cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Display Name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Display Name must be at most 128 characters long",
          }),
      });

      let { displayname } = validateAllInputs(schema, {
        displayname: req.body.displayname,
      });

      let result = await this.userHdlrImpl.UpdateDisplayNameLogic(
        req.userid,
        displayname
      );

      APIResponseOK(req, res, result, "Display name set successfully");
    } catch (error) {
      this.logger.error("UpdateDisplayName error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "SET_DISPLAY_NAME_ERR",
          error.toString(),
          "Set display name failed"
        );
      }
    }
  };

  ListInvitesOfUser = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.userid,
      });

      let result = await this.userHdlrImpl.ListInvitesOfUserLogic(userid);
      APIResponseOK(req, res, result, "Invites fetched successfully");
    } catch (error) {
      this.logger.error("ListInvitesOfUser error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_INVITES_ERR",
          error.toString(),
          "List invites failed"
        );
      }
    }
  };

  SetDefaults = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),
        recursive: z.boolean({ message: "Recursive must be a boolean value" }),
        mapzoom: z.number({ message: "Map zoom must be a number" }),
        mapcenter: z.object({
          lat: z
            .number({ message: "Latitude must be a number" })
            .min(-90, { message: "Latitude must be between -90 and 90" })
            .max(90, { message: "Latitude must be between -90 and 90" }),
          lng: z
            .number({ message: "Longitude must be a number" })
            .min(-180, { message: "Longitude must be between -180 and 180" })
            .max(180, { message: "Longitude must be between -180 and 180" }),
        }),
      });

      let { accountid, recursive, mapcenter, mapzoom } = validateAllInputs(
        schema,
        {
          accountid: req.body.accountid,
          recursive: req.body.recursive,
          mapcenter: req.body.mapcenter,
          mapzoom: req.body.mapzoom,
        }
      );

      let result = await this.userHdlrImpl.SetDefaultsLogic(
        req.userid,
        accountid,
        recursive,
        mapcenter.lat,
        mapcenter.lng,
        mapzoom
      );

      APIResponseOK(req, res, result, "User defaults set successfully");
    } catch (error) {
      this.logger.error("SetDefaults error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "SET_DEFAULTS_ERR",
          error.toString(),
          "Set defaults failed"
        );
      }
    }
  };

  GetUserInfo = async (req, res, next) => {
    try {
      let userid = req.userid;
      let result = await this.userHdlrImpl.GetUserInfoLogic(userid);

      let response = {
        userid: result.userid,
        userinfo: result,
      };
      APIResponseOK(req, res, response, "User info fetched successfully");
    } catch (error) {
      this.logger.error("GetUserInfo error: ", error);
      if (error.errcode === "USER_NOT_FOUND") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          {},
          error.message
        );
      }
      APIResponseInternalErr(
        req,
        res,
        "GET_USER_INFO_ERR",
        error.toString(),
        "Get user info failed"
      );
    }
  };

  RecoverUser = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        recoveredby: z
          .string({ message: "Invalid Recovered By User ID format" })
          .uuid({ message: "Recovered By User ID must be a valid UUID" }),
      });

      let { userid, recoveredby } = validateAllInputs(schema, {
        userid: req.params.userid,
        recoveredby: req.userid,
      });

      let result = await this.userHdlrImpl.RecoverUserLogic(
        userid,
        recoveredby
      );

      APIResponseOK(req, res, result, "User recovered successfully");
    } catch (e) {
      this.logger.error("RecoverUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "USER_NOT_FOUND" ||
        e.errcode === "USER_NOT_DELETED" ||
        e.errcode === "CANNOT_RECOVER_SEED_USER" ||
        e.errcode === "SSO_CONFLICT_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "RECOVER_USER_ERR",
          e.toString(),
          "Recover user failed"
        );
      }
    }
  };

  AddUserMobile = async (req, res, next) => {
    try {
      let schema = z.object({
        mobile: z
          .string({ message: "Invalid Mobile format" })
          .regex(/^[6-9]\d{9}$/, {
            message: "Mobile must be a valid 10-digit Indian mobile number",
          }),
      });

      let { mobile } = validateAllInputs(schema, {
        mobile: req.body.mobile,
      });

      let result = await this.userHdlrImpl.AddUserMobileLogic(
        req.userid,
        mobile
      );
      APIResponseOK(req, res, result, "OTP sent for mobile verification");
    } catch (e) {
      this.logger.error("AddUserMobile error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "MOBILE_ALREADY_EXISTS" ||
        e.errcode === "USER_ALREADY_HAS_MOBILE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "TOO_MANY_OTP_REQUESTS" ||
        e.errcode === "SMS_SEND_FAILED" ||
        e.errcode === "INVALID_MOBILE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, {}, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "ADD_USER_MOBILE_ERR",
          e.toString(),
          "Add user mobile failed"
        );
      }
    }
  };

  VerifyAddMobileOtp = async (req, res, next) => {
    try {
      let schema = z.object({
        mobile: z
          .string({ message: "Invalid Mobile format" })
          .regex(/^[6-9]\d{9}$/, {
            message: "Mobile must be a valid 10-digit Indian mobile number",
          }),
      });

      let { mobile } = validateAllInputs(schema, {
        mobile: req.body.mobile,
      });

      let otp = req.body.otp;

      let result = await this.userHdlrImpl.VerifyAddMobileOtpLogic(
        req.userid,
        otp,
        mobile
      );
      APIResponseOK(req, res, result, "Mobile number added successfully");
    } catch (e) {
      this.logger.error("VerifyAddMobileOtp error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "INVALID_OTP" ||
        e.errcode === "MOBILE_ALREADY_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "VERIFY_ADD_MOBILE_OTP_ERR",
          e.toString(),
          "Verify add mobile OTP failed"
        );
      }
    }
  };

  AddUserEmail = async (req, res, next) => {
    try {
      let schema = z.object({
        email: z
          .string({ message: "Invalid Email format" })
          .email({ message: "Email must be a valid email address" }),
      });

      let { email } = validateAllInputs(schema, {
        email: req.body.email,
      });

      const headerReferer = req.headers.origin;

      let result = await this.userHdlrImpl.AddUserEmailLogic(
        req.userid,
        email,
        headerReferer
      );
      APIResponseOK(req, res, result, "Verification email sent successfully");
    } catch (e) {
      this.logger.error("AddUserEmail error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "EMAIL_ALREADY_EXISTS" ||
        e.errcode === "USER_ALREADY_HAS_EMAIL"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "ADD_USER_EMAIL_ERR",
          e.toString(),
          "Add user email failed"
        );
      }
    }
  };

  VerifyEmailPwd = async (req, res, next) => {
    try {
      let schema = z.object({
        verifyid: z
          .string({ message: "Invalid Verification ID format" })
          .uuid({ message: "Verification ID must be a valid UUID" }),
        password: z
          .string({ message: "Password is required" })
          .nonempty({ message: "Password cannot be empty" })
          .min(8, { message: "Password must be at least 6 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
      });

      let { verifyid, password } = validateAllInputs(schema, {
        verifyid: req.body.verifyid,
        password: req.body.password,
      });

      let result = await this.userHdlrImpl.VerifyAddEmailLogic(
        req.userid,
        verifyid,
        password
      );
      APIResponseOK(req, res, result, "Email added successfully");
    } catch (e) {
      this.logger.error("VerifyEmailPwd error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "INVALID_VERIFICATION" ||
        e.errcode === "EMAIL_ALREADY_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "VERIFY_ADD_EMAIL_ERR",
          e.toString(),
          "Verify add email failed"
        );
      }
    }
  };

  ValidateAddEmailVerification = async (req, res, next) => {
    try {
      let schema = z.object({
        verifyid: z
          .string({ message: "Invalid Verification ID format" })
          .uuid({ message: "Verification ID must be a valid UUID" }),
      });

      let { verifyid } = validateAllInputs(schema, {
        verifyid: req.query.verifyid,
      });

      let result = await this.userHdlrImpl.ValidateAddEmailVerificationLogic(
        req.userid,
        verifyid
      );
      APIResponseOK(req, res, result, result.message);
    } catch (e) {
      this.logger.error("ValidateAddEmailVerification error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "VALIDATE_EMAIL_VERIFICATION_ERR",
          e.toString(),
          "Validate email verification failed"
        );
      }
    }
  };

  GetAcceptedTerms = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.userid,
      });

      let result = await this.userHdlrImpl.GetAcceptedTermsLogic(userid);

      APIResponseOK(req, res, result, "Terms fetched successfully");
    } catch (e) {
      this.logger.error("GetAcceptedTerms error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "GET_ACCEPTED_TERMS_ERR",
          e.toString(),
          "Get accepted terms failed"
        );
      }
    }
  };

  PutAcceptedTerms = async (req, res, next) => {
    try {
      let schema = z.object({
        termsandconditions: z.boolean({
          message: "Terms accepted must be a boolean value",
        }),
        privacypolicy: z.boolean({
          message: "Privacy policy must be a boolean value",
        }),
        promotions: z.boolean({
          message: "Promotions must be a boolean value",
        }),
      });

      let { termsandconditions, privacypolicy, promotions } = validateAllInputs(
        schema,
        {
          termsandconditions: req.body.termsandconditions,
          privacypolicy: req.body.privacypolicy,
          promotions: req.body.promotions,
        }
      );

      const acceptedterms = {
        termsandconditions,
        privacypolicy,
        promotions,
      };

      let result = await this.userHdlrImpl.PutAcceptedTermsLogic(
        req.userid,
        acceptedterms
      );

      APIResponseOK(req, res, result, "Terms accepted successfully");
    } catch (e) {
      this.logger.error("PutAcceptedTerms error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "PUT_ACCEPTED_TERMS_ERR",
          e.toString(),
          "Put accepted terms failed"
        );
      }
    }
  };

  GetSosContacts = async (req, res, next) => {
    try {
      let result = await this.userHdlrImpl.GetSosContactsLogic();
      APIResponseOK(req, res, result, "SOS contacts fetched successfully");
    } catch (e) {
      this.logger.error("GetSosContacts error: ", e);
      return APIResponseInternalErr(
        req,
        res,
        "GET_SOS_CONTACTS_ERR",
        e.toString(),
        "Get SOS contacts failed"
      );
    }
  };

  GetDocuments = async (req, res, next) => {
    try {
      let result = await this.userHdlrImpl.GetDocumentsLogic();
      APIResponseOK(req, res, result, "Documents fetched successfully");
    } catch (e) {
      this.logger.error("GetDocuments error: ", e);
      return APIResponseInternalErr(
        req,
        res,
        "GET_DOCUMENTS_ERR",
        e.toString(),
        "Get documents failed"
      );
    }
  };

  SetMpin = async (req, res, next) => {
    try {
      const generateHash = (mpin) => {
        return crypto.createHash("sha256").update(mpin).digest("hex");
      };

      const generateWeakMpinHashes = () => {
        const weakHashes = new Set();

        for (let i = 0; i <= 9; i++) {
          const repeatedPattern = i.toString().repeat(4);
          weakHashes.add(generateHash(repeatedPattern));
        }

        for (let i = 0; i <= 6; i++) {
          const ascendingPattern = [i, i + 1, i + 2, i + 3].join("");
          weakHashes.add(generateHash(ascendingPattern));
        }

        for (let i = 3; i <= 9; i++) {
          const descendingPattern = [i, i - 1, i - 2, i - 3].join("");
          weakHashes.add(generateHash(descendingPattern));
        }

        return weakHashes;
      };

      const weakMpinHashes = generateWeakMpinHashes();

      let schema = z.object({
        mpin: z
          .string({ message: "MPIN is required" })
          .nonempty({ message: "MPIN cannot be empty" })
          .length(64, { message: "Invalid MPIN" })
          .regex(/^[a-f0-9]{64}$/, {
            message: "Invalid MPIN",
          })
          .refine((mpin) => !weakMpinHashes.has(mpin), {
            message: "Insecure MPIN. Use Strong MPIN",
          }),
        isenabled: z.boolean({ message: "isenabled must be a boolean value" }),
        isreset: z
          .boolean({ message: "isreset must be a boolean value" })
          .optional(),
      });

      let { mpin, isenabled, isreset } = validateAllInputs(schema, {
        mpin: req.body.mpin,
        isenabled: req.body.isenabled,
        isreset: req.body.isreset,
      });

      let result = await this.userHdlrImpl.SetMpinLogic(
        req.userid,
        mpin,
        isenabled,
        isreset
      );
      if (isreset) {
        res.clearCookie("token");
        res.clearCookie("refreshtoken");
      }
      APIResponseOK(req, res, result, result.message);
    } catch (e) {
      this.logger.error("SetMpin error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (e.errcode === "MPIN_ALREADY_EXISTS") {
        return APIResponseBadRequest(
          req,
          res,
          "MPIN_ALREADY_EXISTS",
          e.errdata,
          e.message
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "SET_MPIN_ERR",
          e.toString(),
          "Set MPIN failed"
        );
      }
    }
  };

  GetBanners = async (req, res, next) => {
    try {
      const category = req.query.category || "mobile";
      let result = await this.userHdlrImpl.GetBannersLogic(category);
      APIResponseOK(req, res, result, "Banners fetched successfully");
    } catch (e) {
      this.logger.error("GetBanners error: ", e);
      return APIResponseInternalErr(
        req,
        res,
        "GET_BANNERS_ERR",
        e.toString(),
        "Get banners failed"
      );
    }
  };

  RefreshToken = async (req, res, next) => {
    try {
      let result = await this.userHdlrImpl.RefreshTokenLogic(req);

      res.cookie("token", result.token, {
        httpOnly: true,
        secure: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "None",
      });

      APIResponseOK(req, res, result, "Token refreshed successfully");
    } catch (e) {
      this.logger.error("RefreshToken error: ", e);
      if (
        e.errcode === "INPUT_ERROR" ||
        e.errcode === "INVALID_TOKEN" ||
        e.errcode === "USER_NOT_ACTIVE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "REFRESH_TOKEN_ERR",
          e.toString(),
          "Token refresh failed"
        );
      }
    }
  };

  UpdatePassword = async (req, res, next) => {
    try {
      let schema = z.object({
        oldpassword: z
          .string({ message: "Old password is required" })
          .nonempty({ message: "Old password cannot be empty" }),
        newpassword: z
          .string({ message: "New password is required" })
          .nonempty({ message: "New password cannot be empty" })
          .min(8, {
            message: "New password must be at least 8 characters long",
          })
          .max(128, { message: "New password must not exceed 128 characters" }),
      });

      let { oldpassword, newpassword } = validateAllInputs(schema, {
        oldpassword: req.body.oldpassword,
        newpassword: req.body.newpassword,
      });

      let result = await this.userHdlrImpl.UpdatePasswordLogic(
        req.userid,
        oldpassword,
        newpassword
      );

      APIResponseOK(req, res, result, "Password updated successfully");
    } catch (e) {
      this.logger.error("UpdatePassword error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "INVALID_OLD_PASSWORD" ||
        e.errcode === "SAME_PASSWORD_ERROR"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_PASSWORD_ERR",
          e.toString(),
          "Update password failed"
        );
      }
    }
  };
}