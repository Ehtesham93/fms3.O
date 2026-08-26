import crypto from "crypto";
import promiserouter from "express-promise-router";
import { UAParser } from "ua-parser-js";
import z from "zod";
import {
  APIResponseBadRequest,
  APIResponseError,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
  APIResponseUnauthorized,
} from "../../../utils/responseutil.js";
import { AuthenticateAccountTokenFromCookie } from "../../../utils/tokenutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import fmsAccountHdlrImpl from "./fmsaccounthdlr_impl.js";

import PermissionSvc from "../../../services/permsvc/permsvc.js";
import { INVITE_RATE_LIMIT_PER_HOUR } from "../../../utils/constant.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import { Sleep } from "../../../utils/commonutil.js";

export default class FmsAccountHdlr {
  constructor(
    fmsAccountSvcI,
    userSvcI,
    logger,
    platformSvcI,
    inMemCacheI,
    redisSvc,
    config
  ) {
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.fmsAccountHdlrImpl = new fmsAccountHdlrImpl(
      fmsAccountSvcI,
      userSvcI,
      logger,
      platformSvcI,
      redisSvc
    );
    this.logger = logger;
    this.config = config;
    this.inMemCacheI = inMemCacheI;
    this.permissionSvc = new PermissionSvc(fmsAccountSvcI, userSvcI, logger);
  }

  // TODO: add permission check for each route
  RegisterRoutes(router) {
    const accountTokenGroup = promiserouter();

    accountTokenGroup.use(AuthenticateAccountTokenFromCookie);
    accountTokenGroup.use(this.VerifyUserAccountAccess);
    if (this.config.fmsFeatures.enableCreditChecks) {
      accountTokenGroup.use(this.CheckEnoughCredits);
    }

    router.use("/", accountTokenGroup);

    accountTokenGroup.get("/invites", this.ListInvitesOfAccount);
    accountTokenGroup.get("/fleet/:fleetid/invites", this.ListInvitesOfFleet);
    accountTokenGroup.post("/invite/cancel", this.CancelEmailInvite);
    accountTokenGroup.post("/invite/send", this.SendUserInvite);
    accountTokenGroup.post("/invite/resend", this.ResendEmailInvite);
    accountTokenGroup.post("/invite/validate", this.ValidateInvite);

    accountTokenGroup.get("/overview", this.GetAccountOverview);
    accountTokenGroup.get("/fleets", this.GetAccountFleets);
    accountTokenGroup.get("/modules", this.GetAccountModules);
    accountTokenGroup.get("/chargestationtypes", this.GetChargeStationTypes);

    // fleet management
    accountTokenGroup.post("/fleet", this.CreateFleet);
    accountTokenGroup.get("/fleet/:fleetid", this.GetFleetInfo);
    accountTokenGroup.put("/fleet/:fleetid", this.EditFleet);
    accountTokenGroup.get("/fleet/:fleetid/subfleets", this.GetSubFleets);
    accountTokenGroup.delete("/fleet/:fleetid", this.DeleteFleet);

    // vehicle management
    accountTokenGroup.get("/fleet/:fleetid/vehicles", this.GetVehicles);
    accountTokenGroup.put("/fleet/vehicle/:vehicleid/move", this.MoveVehicle);
    accountTokenGroup.delete(
      "/fleet/:fleetid/vehicle/:vehicleid",
      this.RemoveVehicle
    );
    accountTokenGroup.get(
      "/vehicle/:vehicleid/listmoveablefleets",
      this.ListMoveableFleets
    );
    accountTokenGroup.get("/vehicles/subscribed", this.ListSubscribedVehicles);

    // role management
    accountTokenGroup.post("/role", this.CreateRole);
    accountTokenGroup.put("/role/:roleid", this.UpdateRole);
    accountTokenGroup.get("/roles", this.ListRoles);
    accountTokenGroup.get("/role/:roleid", this.GetRoleInfo);
    accountTokenGroup.put("/role/:roleid/perms", this.UpdateRolePerms);
    accountTokenGroup.delete("/role/:roleid", this.DeleteRole);
    accountTokenGroup.get("/rolehistory", this.GetFleetUserRoleHistory);

    // accountTokenGroup.get("/roles/history", this.GetRoleHistory);
    // accountTokenGroup.get("/roles/perms/history", this.GetRolePermHistory);

    // user management
    accountTokenGroup.get("/fleet/:fleetid/users", this.ListUsers);
    accountTokenGroup.get("/fleet/:fleetid/user/:userid", this.GetUserInfo);
    accountTokenGroup.get(
      "/fleet/:fleetid/user/:userid/assignableroles",
      this.GetAssignableRoles
    );
    accountTokenGroup.post("/fleet/:fleetid/assignrole", this.AssignUserRole);
    accountTokenGroup.post(
      "/fleet/:fleetid/deassignrole",
      this.DeassignUserRole
    );

    accountTokenGroup.delete("/user/:userid/remove", this.RemoveUser);

    // subscription management
    accountTokenGroup.get("/subscriptions", this.GetAccountSubscriptions);
    accountTokenGroup.post(
      "/subscription/checkchangepkg",
      this.CheckChangeSubscriptionPackage
    );
    accountTokenGroup.post("/subscription", this.UpdateAccountSubscription);
    accountTokenGroup.get("/subscription/history", this.GetSubscriptionHistory);

    // vehicle subscription management
    accountTokenGroup.get(
      "/subscription/vehicles",
      this.GetSubscriptionVehicles
    );
    accountTokenGroup.get(
      "/subscription/vehicles/history",
      this.GetSubscriptionVehiclesHistory
    );
    accountTokenGroup.post(
      "/subscription/intent",
      this.CreateSubscriptionIntent
    );
    accountTokenGroup.post("/subscription/subscribe", this.SubscribeVehicle);
    accountTokenGroup.post(
      "/subscription/unsubscribe",
      this.UnsubscribeVehicle
    );

    accountTokenGroup.get("/credits", this.GetAccountCredits);
    accountTokenGroup.get("/credits/overview", this.GetAccountCreditsOverview);
    accountTokenGroup.get("/credits/history", this.GetAccountCreditsHistory);
    accountTokenGroup.get(
      "/vehicle/:vinno/credits/history",
      this.GetAccountVehicleCreditsHistory
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/credits/history",
      this.GetAccountFleetCreditsHistory
    );

    // tag vehicle
    accountTokenGroup.post("/tagvehicle", this.TagVehicle);
    accountTokenGroup.put("/untagvehicle", this.UntagVehicle);
    accountTokenGroup.get("/vehicles/taggedout", this.GetTaggedOutVehicles);
    accountTokenGroup.get("/vehicle/:vinno/shared", this.GetSharedAccounts);
    accountTokenGroup.get("/vehicles/taggedin", this.GetTaggedInVehicles);

    accountTokenGroup.get(
      "/fleet/:fleetid/getmyperms",
      this.GetMyFleetPermissions
    );

    accountTokenGroup.get(
      "/assignmenthistory",
      this.GetAccountAssignmentHistory
    );
  }

  ValidateEpochTime = (timeStr, fieldName) => {
    if (!/^\d+$/.test(timeStr)) {
      throw {
        errcode: "INPUT_ERROR",
        message: `${fieldName} must be a valid epoch time (integer)`,
      };
    }

    const epochTime = parseInt(timeStr, 10);

    if (epochTime < 1000000000000 || epochTime > 9999999999999) {
      throw {
        errcode: "INPUT_ERROR",
        message: `${fieldName} must be a valid epoch time`,
      };
    }

    return epochTime;
  };

  getDeviceFingerprint = (req) => {
    const ip =
      req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null);

    const userAgent = req.headers["user-agent"] || "";
    const referrer = req.headers["referer"] || "";
    const parser = new UAParser(userAgent);
    const ua = parser.getResult();
    const useragentstr = `${ip}-${JSON.stringify(ua)}-${referrer}`;
    const deviceFingerprint = crypto
      .createHash("sha256")
      .update(useragentstr)
      .digest("hex");

    return deviceFingerprint;
  };

  getInviteFingerprint = (req, accountid, fleetid, contact) => {
    const deviceFingerprint = this.getDeviceFingerprint(req);
    const inviteSpecificData = `${deviceFingerprint}-${accountid}-${fleetid}-${contact}`;
    const inviteFingerprint = crypto
      .createHash("sha256")
      .update(inviteSpecificData)
      .digest("hex");

    return inviteFingerprint;
  };

  getOperationFingerprint = (req, operation, additionalContext = "") => {
    const deviceFingerprint = this.getDeviceFingerprint(req);
    const fingerprintData = `${deviceFingerprint}-${operation}-${req.userid}-${req.accountid}-${additionalContext}`;
    return crypto.createHash("sha256").update(fingerprintData).digest("hex");
  };

  checkOperationRateLimit = (operationFingerprint, operationType) => {
    const rateLimitConfig = this.config.rateLimiting[operationType];
    if (!rateLimitConfig) {
      return { allowed: true };
    }

    if (rateLimitConfig.perMinute) {
      const rateLimitKeyMinute = `${operationType}_rate_limit_minute:${operationFingerprint}`;
      const currentCountMinute = this.inMemCacheI.get(rateLimitKeyMinute) || 0;

      if (currentCountMinute >= rateLimitConfig.perMinute.max) {
        return {
          allowed: false,
          reason: "minute_limit_exceeded",
          message: `Too many ${operationType} attempts. Please try again after 1 minute.`,
        };
      }
    }

    if (rateLimitConfig.perHour) {
      const rateLimitKeyHour = `${operationType}_rate_limit_hour:${operationFingerprint}`;
      const currentCountHour = this.inMemCacheI.get(rateLimitKeyHour) || 0;

      if (currentCountHour >= rateLimitConfig.perHour.max) {
        return {
          allowed: false,
          reason: "hour_limit_exceeded",
          message: `Too many ${operationType} attempts. Please try again after 1 hour.`,
        };
      }
    }

    return { allowed: true };
  };

  updateOperationRateLimit = (operationFingerprint, operationType) => {
    const rateLimitConfig = this.config.rateLimiting[operationType];
    if (!rateLimitConfig) return;

    if (rateLimitConfig.perMinute) {
      const rateLimitKeyMinute = `${operationType}_rate_limit_minute:${operationFingerprint}`;
      const currentCountMinute = this.inMemCacheI.get(rateLimitKeyMinute) || 0;
      this.inMemCacheI.set(rateLimitKeyMinute, currentCountMinute + 1, 60);
    }

    if (rateLimitConfig.perHour) {
      const rateLimitKeyHour = `${operationType}_rate_limit_hour:${operationFingerprint}`;
      const currentCountHour = this.inMemCacheI.get(rateLimitKeyHour) || 0;
      this.inMemCacheI.set(rateLimitKeyHour, currentCountHour + 1, 3600);
    }

    this.logger.info(
      `${operationType} rate limit updated for fingerprint: ${operationFingerprint.substring(
        0,
        8
      )}...`
    );
  };

  VerifyUserAccountAccess = async (req, res, next) => {
    try {
      const { accountid, userid } = req;

      if (!accountid || !userid) {
        APIResponseUnauthorized(
          req,
          res,
          "MISSING_CREDENTIALS",
          "Account ID or User ID missing from token"
        );
        return;
      }

      const hasAccess = await this.fmsAccountSvcI.IsUserInAccount(
        accountid,
        userid
      );

      if (!hasAccess) {
        APIResponseUnauthorized(
          req,
          res,
          "ACCESS_DENIED",
          "User does not have access to this account"
        );
        return;
      }

      next();
    } catch (error) {
      this.logger.error(
        `fmsaccounthdlr.VerifyUserAccountAccess: error: ${error}`
      );
      APIResponseInternalErr(
        req,
        res,
        error,
        "Failed to verify user account access"
      );
    }
  };

  CheckEnoughCredits = async (req, res, next) => {
    try {
      const { accountid } = req;

      if (!accountid) {
        APIResponseUnauthorized(
          req,
          res,
          "MISSING_CREDENTIALS",
          {},
          "Account ID missing from token"
        );
        return;
      }

      const userAgent = req.headers["user-agent"] || "";

      // Skip credit checks for iOS and Android requests
      if (/android/i.test(userAgent) || /iphone|ipad|ipod/i.test(userAgent)) {
        next();
        return;
      }

      const accountInfo = await this.fmsAccountSvcI.GetAccountAndPackageInfo(
        accountid
      );

      if (!accountInfo) {
        APIResponseForbidden(
          req,
          res,
          "NO_PACKAGE_SUBSCRIPTION",
          {},
          "Account does not have an active package subscription"
        );
        return;
      }

      const {
        total_subscribed_vehicles,
        graceperiod,
        available_credits,
        total_credits_per_vehicle_day,
      } = accountInfo;

      const graceCredits =
        -1 *
        (total_subscribed_vehicles *
          graceperiod *
          total_credits_per_vehicle_day);

      if (available_credits < graceCredits) {
        APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_CREDITS",
          {},
          `Insufficient credits. Your limit is ${graceCredits} credits, but you are currently at ${available_credits} credits`
        );
        return;
      }

      next();
    } catch (error) {
      this.logger.error(`fmsaccounthdlr.CheckEnoughCredits: error: ${error}`);
      APIResponseInternalErr(
        req,
        res,
        error,
        {},
        "Failed to check credit sufficiency"
      );
    }
  };

  ListInvitesOfAccount = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      let result = await this.fmsAccountHdlrImpl.ListInvitesOfAccountLogic(
        accountid
      );
      APIResponseOK(req, res, result, "Invites listed successfully");
    } catch (error) {
      this.logger.error("ListInvitesOfAccount error: ", error);
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
          error,
          "Failed to list invites of account"
        );
      }
    }
  };

  ListInvitesOfFleet = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
      });

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });

      let result = await this.fmsAccountHdlrImpl.ListInvitesOfFleetLogic(
        accountid,
        fleetid,
        recursive
      );
      APIResponseOK(req, res, result, "Fleet invites listed successfully");
    } catch (error) {
      this.logger.error("ListInvitesOfFleet error: ", error);
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
          error,
          "Failed to list invites of fleet"
        );
      }
    }
  };

  CancelEmailInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        cancelledby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID is missing in token" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        inviteid: z
          .string({ message: "Invalid Invite ID format" })
          .uuid({ message: "Invalid Invite ID format" }),
      });

      let { cancelledby, accountid, inviteid } = validateAllInputs(schema, {
        cancelledby: req.userid,
        accountid: req.accountid,
        inviteid: req.body.inviteid,
      });

      let result = await this.fmsAccountHdlrImpl.CancelEmailInviteLogic(
        accountid,
        inviteid,
        cancelledby
      );
      APIResponseOK(req, res, result, "Email invite cancelled successfully");
    } catch (error) {
      this.logger.error("CancelEmailInvite error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "INVALID_INVITE_ID" ||
        error.errcode === "INVITE_NOT_IN_SENT_STATE" ||
        error.errcode === "INVITE_NOT_AN_EMAIL_INVITE" ||
        error.errcode === "CANNOT_CANCEL_AN_EXPIRED_INVITE"
      ) {
        APIResponseBadRequest(req, res, error.errcode, null, error.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          "Failed to cancel email invite"
        );
      }
    }
  };

  SendUserInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        invitedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        roleids: z
          .array(
            z
              .string({ message: "Invalid Role IDs format" })
              .uuid({ message: "Invalid Role ID format" })
              .nonempty({ message: "Invalid Role ID format" })
          )
          .nonempty({ message: "At least one Role ID is required" }),
        contact: z
          .string({ message: "Invalid Contact format" })
          .nonempty({ message: "Contact cannot be empty" })
          .refine(
            (val) =>
              /^[6-9]\d{9}$/.test(val) ||
              z.string().email().safeParse(val).success,
            {
              message:
                "Contact must be a valid email or Indian mobile number (10 digits starting with 6-9)",
            }
          ),
      });

      let { invitedby, accountid, fleetid, roleids, contact } =
        validateAllInputs(schema, {
          invitedby: req.userid,
          accountid: req.accountid,
          fleetid: req.body.fleetid,
          roleids: req.body.roleids,
          contact: req.body.contact,
        });

      // perm check
      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["account.users.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to invite users."
        );
      }

      const inviteFingerprint = this.getInviteFingerprint(
        req,
        accountid,
        fleetid,
        contact
      );
      const rateLimitKey = `email_invite_rate_limit:${inviteFingerprint}`;
      let currentCount = this.inMemCacheI.get(rateLimitKey) || 0;

      if (currentCount >= INVITE_RATE_LIMIT_PER_HOUR) {
        const error = new Error(
          "Too many invites sent to this contact for this account and fleet. Please try after an hour."
        );
        error.errcode = "RATE_LIMIT_EXCEEDED";
        throw error;
      }

      let headerReferer = req.headers.origin;
      let result = await this.fmsAccountHdlrImpl.SendUserInviteLogic(
        accountid,
        fleetid,
        roleids,
        contact,
        invitedby,
        headerReferer
      );
      this.inMemCacheI.set(rateLimitKey, currentCount + 1);

      APIResponseOK(req, res, result, "Email invite sent successfully");
    } catch (error) {
      this.logger.error("SendUserInvite error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (error.errcode === "RATE_LIMIT_EXCEEDED") {
        APIResponseError(
          req,
          res,
          429,
          "RATE_LIMIT_EXCEEDED",
          null,
          "Too many invites sent to this contact for this account and fleet. Please try after an hour."
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "INVITE_ERR",
          error.errdata,
          error.message
        );
      }
    }
  };

  ResendEmailInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        invitedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        inviteid: z
          .string({ message: "Invalid Invite ID format" })
          .uuid({ message: "Invalid Invite ID format" }),
      });

      let { invitedby, accountid, inviteid } = validateAllInputs(schema, {
        invitedby: req.userid,
        accountid: req.accountid,
        inviteid: req.body.inviteid,
      });

      const deviceFingerprint = this.getDeviceFingerprint(req);
      const resendFingerprint = crypto
        .createHash("sha256")
        .update(`${deviceFingerprint}-${inviteid}`)
        .digest("hex");
      const rateLimitKey = `email_resend_rate_limit:${resendFingerprint}`;

      let currentCount = this.inMemCacheI.get(rateLimitKey) || 0;

      if (currentCount >= INVITE_RATE_LIMIT_PER_HOUR) {
        const error = new Error(
          "Too many resend attempts for this invite. Please try after an hour."
        );
        error.errcode = "RATE_LIMIT_EXCEEDED";
        throw error;
      }

      let headerReferer = req.headers.origin;
      let result = await this.fmsAccountHdlrImpl.ResendEmailInviteLogic(
        accountid,
        inviteid,
        invitedby,
        headerReferer
      );
      this.inMemCacheI.set(rateLimitKey, currentCount + 1);

      APIResponseOK(req, res, result, "Email invite resent successfully");
    } catch (error) {
      this.logger.error("ResendEmailInvite error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "INVALID_INVITE_ID" ||
        error.errcode === "INVITE_NOT_IN_SENT_STATE" ||
        error.errcode === "INVITE_NOT_AN_EMAIL_INVITE" ||
        error.errcode === "CANNOT_RESEND_AN_EXPIRED_INVITE" ||
        error.errcode === "ACCOUNT_NOT_FOUND" ||
        error.errcode === "FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(req, res, error.errcode, null, error.message);
      } else if (error.errcode === "RATE_LIMIT_EXCEEDED") {
        APIResponseError(
          req,
          res,
          429,
          "RATE_LIMIT_EXCEEDED",
          null,
          "Too many resend attempts for this invite. Please try after an hour."
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error.errcode,
          null,
          "Failed to resend email invite"
        );
      }
    }
  };

  ValidateInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        inviteid: z
          .string({ message: "Invalid Invite ID format" })
          .uuid({ message: "Invalid Invite ID format" }),
      });

      let { userid, inviteid } = validateAllInputs(schema, {
        userid: req.userid,
        inviteid: req.body.inviteid,
      });

      let result = await this.fmsAccountHdlrImpl.ValidateInviteLogic(
        inviteid,
        userid
      );
      APIResponseOK(req, res, result, "Invite validated successfully");
    } catch (error) {
      this.logger.error("ValidateInvite error: ", error);
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
          "VALIDATE_INVITE_ERR",
          error.toString(),
          "Validate invite failed"
        );
      }
    }
  };

  GetAccountOverview = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      // const userPerms = await this.permissionSvc.GetUserFleetPermissions(
      //   req.userid,
      //   accountid
      // );

      // if (
      //   !CheckUserPerms(userPerms, [
      //     "account.settings.view",
      //     "account.settings.admin",
      //   ])
      // ) {
      //   return APIResponseForbidden(
      //     req,
      //     res,
      //     "INSUFFICIENT_PERMISSIONS",
      //     null,
      //     "You don't have permission to get account overview."
      //   );
      // }

      let result = await this.fmsAccountHdlrImpl.GetAccountOverviewLogic(
        accountid
      );
      APIResponseOK(req, res, result, "Account overview fetched successfully");
    } catch (error) {
      this.logger.error("GetAccountOverview error: ", error);
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
          "GET_ACCOUNT_OVERVIEW_ERR",
          error.toString(),
          "Get account overview failed"
        );
      }
    }
  };

  GetAccountFleets = async (req, res, next) => {
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
        accountid: req.accountid,
      });

      // const userPerms = await this.permissionSvc.GetUserFleetPermissions(
      //   req.userid,
      //   req.accountid
      // );

      // if (
      //   !CheckUserPerms(userPerms, [
      //     "account.fleets.view",
      //     "account.fleets.admin",
      //   ])
      // ) {
      //   return APIResponseForbidden(
      //     req,
      //     res,
      //     "INSUFFICIENT_PERMISSIONS",
      //     null,
      //     "You don't have permission to get account fleets."
      //   );
      // }

      let result = await this.fmsAccountHdlrImpl.GetAccountFleetsLogic(
        accountid,
        userid
      );
      APIResponseOK(req, res, result, "Fms Accounts fetched successfully");
    } catch (error) {
      this.logger.error("GetAccountFleets error: ", error);
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
          "GET_ACCOUNT_FLEETS_ERR",
          error.toString(),
          "Get account fleets failed"
        );
      }
    }
  };

  GetAccountModules = async (req, res, next) => {
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
        accountid: req.accountid,
      });

      // const userPerms = await this.permissionSvc.GetUserFleetPermissions(
      //   req.userid,
      //   accountid
      // );

      // if (
      //   !CheckUserPerms(userPerms, [
      //     "account.users.admin",
      //     "account.modules.view",
      //   ])
      // ) {
      //   return APIResponseForbidden(
      //     req,
      //     res,
      //     "INSUFFICIENT_PERMISSIONS",
      //     null,
      //     "You don't have permission to get account modules."
      //   );
      // }

      let result = await this.fmsAccountHdlrImpl.GetAccountModulesLogic(
        accountid,
        userid
      );
      APIResponseOK(req, res, result, "FMS permissions fetched successfully");
    } catch (error) {
      this.logger.error("GetAccountModules error: ", error);
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
          "GET_FMS_PERMISSIONS_ERR",
          error.toString(),
          "Get fms permissions failed"
        );
      }
    }
  };

  GetChargeStationTypes = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      let result = await this.fmsAccountHdlrImpl.GetChargeStationTypesLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Charge station types fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetChargeStationTypes error: ", error);
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
          "GET_CHARGER_STATION_TYPES_ERR",
          error.toString(),
          "Get charge station types failed"
        );
      }
    }
  };

  // fleet management
  CreateFleet = async (req, res, next) => {
    try {
      let schema = z.object({
        createdby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        parentfleetid: z
          .string({ message: "Invalid Parent Fleet ID format" })
          .uuid({ message: "Invalid Parent Fleet ID format" }),
        fleetname: z
          .string({ message: "Fleet name is required" })
          .min(1, { message: "Fleet name is required" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Fleet name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Fleet name must be at most 128 characters long",
          })
          .regex(/^[^\/]*$/, { message: "Fleet name should not contain '/'" }),
      });

      let { createdby, accountid, parentfleetid, fleetname } =
        validateAllInputs(schema, {
          createdby: req.userid,
          accountid: req.accountid,
          parentfleetid: req.body.parentfleetid,
          fleetname: req.body.fleetname,
        });

      const operationFingerprint = this.getOperationFingerprint(
        req,
        "fleetCreation",
        parentfleetid
      );
      const rateLimitResult = this.checkOperationRateLimit(
        operationFingerprint,
        "fleetCreation"
      );

      if (!rateLimitResult.allowed) {
        return APIResponseError(
          req,
          res,
          429,
          "FLEET_CREATION_RATE_LIMIT_EXCEEDED",
          rateLimitResult.message,
          rateLimitResult.message
        );
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        parentfleetid
      );

      if (!CheckUserPerms(userPerms, ["account.fleets.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create fleet."
        );
      }

      if (fleetname.includes("/")) {
        return APIResponseBadRequest(
          req,
          res,
          "INVALID_FLEET_NAME",
          null,
          "Fleet name should not have forward slash"
        );
      }

      let result = await this.fmsAccountHdlrImpl.CreateFleetLogic(
        accountid,
        parentfleetid,
        fleetname,
        createdby
      );

      this.updateOperationRateLimit(operationFingerprint, "fleetCreation");

      APIResponseOK(req, res, result, "Fleet created successfully");
    } catch (error) {
      this.logger.error("CreateFleet error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      }

      const validationErrorCodes = [
        "RESERVED_FLEET_NAME",
        "PARENT_FLEET_NOT_FOUND",
        "DUPLICATE_FLEET_NAME",
        "FLEET_DEPTH_LIMIT_EXCEEDED",
        "FLEET_COUNT_LIMIT_EXCEEDED",
      ];

      if (error.errcode && validationErrorCodes.includes(error.errcode)) {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      }

      APIResponseInternalErr(
        req,
        res,
        "CREATE_FLEET_ERR",
        error.toString(),
        "Failed to create fleet"
      );
    }
  };

  GetFleetInfo = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
      });

      let { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.fleets.view",
          "account.fleets.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet info."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetFleetInfoLogic(
        accountid,
        fleetid
      );
      APIResponseOK(req, res, result, "Fleet info fetched successfully");
    } catch (error) {
      this.logger.error("GetFleetInfo error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_FLEET_INFO_ERR",
          error.toString(),
          "Get fleet info failed"
        );
      }
    }
  };

  EditFleet = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),

        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),

        fleetname: z
          .string({ message: "Fleet name is required" })
          .min(1, { message: "Fleet name is required" })
          .max(128, {
            message: "Fleet name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Fleet Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),

        fleetinfo: z
          .record(z.any(), { message: "Fleet info must be an object" })
          .optional(),
      });

      let { accountid, fleetid, userid, fleetname, fleetinfo } =
        validateAllInputs(schema, {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          fleetname: req.body.fleetname,
          fleetinfo: req.body.fleetinfo,
          userid: req.userid,
        });

      const updateFields = {};
      if (fleetname !== undefined) updateFields.name = fleetname;
      if (fleetinfo !== undefined) updateFields.fleetinfo = fleetinfo;

      if (Object.keys(updateFields).length === 0) {
        APIResponseBadRequest(
          req,
          res,
          "NO_UPDATE_FIELDS",
          null,
          "No fields provided for update"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["account.fleets.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to edit fleet."
        );
      }

      let result = await this.fmsAccountHdlrImpl.EditFleetLogic(
        accountid,
        fleetid,
        updateFields,
        userid
      );

      APIResponseOK(req, res, result, "Fleet edited successfully");
    } catch (error) {
      this.logger.error("EditFleet error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "EDIT_FLEET_ERR",
          error.toString(),
          "Edit fleet failed"
        );
      }
    }
  };

  GetSubFleets = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
      });

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      const { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.fleets.view",
          "account.fleets.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get subfleets."
        );
      }

      const result = await this.fmsAccountHdlrImpl.GetSubFleetsLogic(
        accountid,
        fleetid,
        recursive
      );

      APIResponseOK(req, res, result, "Subfleets fetched successfully");
    } catch (error) {
      this.logger.error("GetSubFleets error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_SUBFLEETS_ERR",
          error.toString(),
          "Get subfleets failed"
        );
      }
    }
  };

  DeleteFleet = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Fleet ID must be a valid UUID" }),

        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { accountid, fleetid, deletedby } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
        deletedby: req.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["account.fleets.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete fleet."
        );
      }

      let result = await this.fmsAccountHdlrImpl.DeleteFleetLogic(
        accountid,
        fleetid,
        deletedby
      );

      APIResponseOK(req, res, result, "Fleet deleted successfully");
    } catch (error) {
      this.logger.error("DeleteFleet error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_HAS_VEHICLES" ||
        error.errcode === "ROOT_FLEET_PROTECTED" ||
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "FLEET_HAS_SUBFLEETS" ||
        error.errcode === "FLEET_HAS_USERS"
      ) {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_FLEET_ERR",
          error.toString(),
          "Delete fleet failed"
        );
      }
    }
  };

  // vehicle management
  ListSubscribedVehicles = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      let result = await this.fmsAccountHdlrImpl.ListSubscribedVehiclesLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Subscribed vehicles fetched successfully"
      );
    } catch (error) {
      this.logger.error("ListSubscribedVehicles error: ", error);
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
          error,
          null,
          "Failed to get subscribed vehicles"
        );
      }
    }
  };

  // role management
  CreateRole = async (req, res, next) => {
    try {
      const accountid = req.accountid;
      const createdby = req.userid;

      const schema = z.object({
        rolename: z
          .string({ message: "Invalid Role Name format" })
          .nonempty({ message: "Role name cannot be empty" })
          .max(128, {
            message: "Role name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Role name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
        roletype: z.literal("account", {
          errorMap: () => ({
            message: "Invalid role type, only account roles can be created",
          }),
        }),
        isenabled: z.boolean({ message: "isenabled must be a boolean" }),
      });

      const { rolename, roletype, isenabled } = validateAllInputs(schema, {
        rolename: req.body.rolename,
        roletype: req.body.roletype,
        isenabled: req.body.isenabled,
      });

      const operationFingerprint = this.getOperationFingerprint(
        req,
        "roleCreation"
      );
      const rateLimitResult = this.checkOperationRateLimit(
        operationFingerprint,
        "roleCreation"
      );

      if (!rateLimitResult.allowed) {
        return APIResponseError(
          req,
          res,
          429,
          "ROLE_CREATION_RATE_LIMIT_EXCEEDED",
          rateLimitResult.message,
          rateLimitResult.message
        );
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.roles.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create role."
        );
      }

      const result = await this.fmsAccountHdlrImpl.CreateRoleLogic(
        accountid,
        rolename,
        roletype,
        isenabled,
        createdby
      );

      this.updateOperationRateLimit(operationFingerprint, "roleCreation");

      APIResponseOK(req, res, result, "Role created successfully");
    } catch (error) {
      this.logger.error("CreateRole error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (error.message === "ROLE_NAME_ALREADY_EXISTS") {
        APIResponseBadRequest(
          req,
          res,
          "ROLE_NAME_ALREADY_EXISTS",
          null,
          "Role name already exists"
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_ROLE_ERR",
          error.toString(),
          "Create role failed"
        );
      }
    }
  };

  UpdateRole = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        roleid: z
          .string({ message: "Invalid Role ID format" })
          .nonempty({ message: "Role ID cannot be empty" })
          .uuid({ message: "Invalid Role ID format" }),

        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),

        rolename: z
          .string({ message: "Invalid Role Name format" })
          .max(128, {
            message: "Role name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Role name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .optional(),

        roletype: z
          .enum(["account", "platform"], { message: "Invalid Role Type" })
          .optional(),

        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
      });

      let { accountid, roleid, updatedby, rolename, roletype, isenabled } =
        validateAllInputs(schema, {
          accountid: req.accountid,
          roleid: req.params.roleid,
          updatedby: req.userid,
          ...req.body,
        });

      if (roletype && roletype !== "account") {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_ROLE_TYPE",
          {},
          "Invalid role type, only 'account' role updates are allowed"
        );
        return;
      }

      const updateFields = {};
      if (rolename !== undefined) updateFields.rolename = rolename;
      if (roletype !== undefined) updateFields.roletype = roletype;
      if (isenabled !== undefined) updateFields.isenabled = isenabled;

      if (Object.keys(updateFields).length === 0) {
        APIResponseBadRequest(
          req,
          res,
          "NO_UPDATE_FIELDS",
          {},
          "No valid fields provided for update"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.roles.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update role."
        );
      }

      let result = await this.fmsAccountHdlrImpl.UpdateRoleLogic(
        accountid,
        roleid,
        updateFields,
        updatedby
      );

      APIResponseOK(req, res, result, "Role updated successfully");
    } catch (error) {
      this.logger.error("UpdateRole error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_ROLE_ERR",
          error.toString(),
          "Update role failed"
        );
      }
    }
  };

  ListRoles = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.roles.admin",
          "account.roles.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list roles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.ListRolesLogic(accountid);
      APIResponseOK(req, res, result, "Roles fetched successfully");
    } catch (error) {
      this.logger.error("ListRoles error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_ROLES_ERR",
          error.toString(),
          "List roles failed"
        );
      }
    }
  };

  GetRoleInfo = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        roleid: z
          .string({ message: "Invalid role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" })
          .nonempty({ message: "Role ID is required" }),
      });

      let { accountid, roleid } = validateAllInputs(schema, {
        accountid: req.accountid,
        roleid: req.params.roleid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.roles.admin",
          "account.roles.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get role info."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetRoleInfoLogic(
        accountid,
        roleid
      );
      APIResponseOK(req, res, result, "Role fetched successfully");
    } catch (error) {
      this.logger.error("GetRoleInfo error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (error.errcode === "ROLE_NOT_FOUND") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          {},
          "Role not found"
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ROLE_ERR",
          error.errdata,
          error.message
        );
      }
    }
  };

  UpdateRolePerms = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" })
          .nonempty({ message: "Role ID is required" }),

        updatedperms: z.array(
          z.object({
            moduleid: z
              .string({ message: "Invalid Module ID format" })
              .uuid({ message: "Invalid Module ID format" }),

            selectedpermids: z
              .array(
                z.string({
                  message: "Invalid Selected Permission ID format",
                }),
                { message: "SelectedPermids must be an array of strings" }
              )
              .optional(),

            deselectedpermids: z
              .array(
                z.string({
                  message: "Invalid Deselected Permission ID format",
                }),
                { message: "DeselectedPermids must be an array of strings" }
              )
              .optional(),
          })
          // TOASK: why we need this?
          // .refine(
          //   (data) =>
          //     (data.selectedpermids && data.selectedpermids.length > 0) ||
          //     (data.deselectedpermids && data.deselectedpermids.length > 0),
          //   {
          //     message:
          //       "At least one of Selectedpermids or Deselectedpermids must be provided",
          //   }
          // )
        ),
      });

      let { accountid, roleid, updatedperms } = validateAllInputs(schema, {
        accountid: req.accountid,
        roleid: req.params.roleid,
        updatedperms: req.body.updatedperms,
      });

      const updatedby = req.userid;

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.roles.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update role permissions."
        );
      }

      let result = await this.fmsAccountHdlrImpl.UpdateRolePermsLogic(
        accountid,
        roleid,
        updatedperms,
        updatedby
      );

      APIResponseOK(req, res, result, "Role permissions updated successfully");
    } catch (error) {
      this.logger.error("UpdateRolePerms error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (error.errcode === "ROLE_NOT_FOUND") {
        return APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Role not found"
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_ROLE_PERMS_ERR",
          error.toString(),
          "Update role permissions failed"
        );
      }
    }
  };

  DeleteRole = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" }),

        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { accountid, roleid, deletedby } = validateAllInputs(schema, {
        accountid: req.accountid,
        roleid: req.params.roleid,
        deletedby: req.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.roles.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete role."
        );
      }

      let result = await this.fmsAccountHdlrImpl.DeleteRoleLogic(
        accountid,
        roleid,
        deletedby
      );

      APIResponseOK(req, res, result, "Role deleted successfully");
    } catch (error) {
      this.logger.error("DeleteRole error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "ROLE_IN_USE" ||
        error.errcode === "ROLE_HAS_PERMISSIONS" ||
        error.errcode === "ROLE_NOT_FOUND" ||
        error.errcode === "CANNOT_DELETE_ADMIN_ROLE" ||
        error.errcode === "INVALID_ROLE_TYPE"
      ) {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_ROLE_ERR",
          error.toString(),
          "Delete role failed"
        );
      }
    }
  };

  GetRoleHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["account.roles.view"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get role history."
      );
    }
    try {
      let schema = z.object({
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });
      const convertedstarttime = parseInt(req.query.starttime);
      const convertedendtime = parseInt(req.query.endtime);
      const { starttime, endtime } = validateAllInputs(schema, {
        starttime: convertedstarttime,
        endtime: convertedendtime,
      });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 95 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 95 days"
        );
        return;
      }

      let result = await this.fmsAccountHdlrImpl.GetRoleHistoryLogic(starttime, endtime);
      APIResponseOK(req, res, result, "Role history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetRoleHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "GET_ROLE_HISTORY_ERR", e.toString(), "Get role history failed");
      }
    }
  };

  GetRolePermHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["account.roles.view"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get role perm history."
      );
    }
    try {
      let schema = z.object({
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });
      const convertedstarttime = parseInt(req.query.starttime);
      const convertedendtime = parseInt(req.query.endtime);
      const { starttime, endtime } = validateAllInputs(schema, {
        starttime: convertedstarttime,
        endtime: convertedendtime,
      });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 95 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 95 days"
        );
        return;
      }

      let result = await this.fmsAccountHdlrImpl.GetRolePermHistoryLogic(starttime, endtime);
      APIResponseOK(req, res, result, "Role perm history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetRolePermHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {  
        return APIResponseInternalErr(req, res, "GET_ROLE_PERM_HISTORY_ERR", e.toString(), "Get role perm history failed");
      }
    }
  };

  // vehicle management
  GetVehicles = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        fleetid: z
          .string({ message: "Fleet ID is required" })
          .uuid({ message: "Fleet ID must be a valid UUID" }),
      });

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let isforcedfilter = req.query.isforcedfilter
        ? req.query.isforcedfilter === "true"
        : false;

      const { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.fleets.view",
          "account.fleets.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicles."
        );
      }

      const result = await this.fmsAccountHdlrImpl.GetVehiclesLogic(
        accountid,
        fleetid,
        recursive,
        isforcedfilter
      );

      APIResponseOK(req, res, result, "Vehicles fetched successfully");
    } catch (error) {
      this.logger.error("GetVehicles error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(req, res, error, "Failed to get vehicles");
      }
    }
  };

  MoveVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        vehicleid: z
          .string({ message: "Invalid Vehicle ID format" })
          .nonempty({ message: "Invalid Vehicle ID format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "Vehicle ID can only contain letters, numbers, and spaces",
          })
          .max(128, {
            message: "Vehicle ID must be at most 128 characters long",
          }),
        fromfleetid: z
          .string({ message: "Invalid From Fleet ID format" })
          .uuid({ message: "Invalid From Fleet ID format" }),
        tofleetid: z
          .string({ message: "Invalid To Fleet ID format" })
          .uuid({ message: "Invalid To Fleet ID format" }),
      });

      let { accountid, vehicleid, fromfleetid, tofleetid } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          vehicleid: req.params.vehicleid,
          fromfleetid: req.body.fromfleetid,
          tofleetid: req.body.tofleetid,
        }
      );

      const userPermsFromFleet =
        await this.permissionSvc.GetUserFleetPermissions(
          req.userid,
          accountid,
          fromfleetid
        );

      if (!CheckUserPerms(userPermsFromFleet, ["account.fleets.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to move vehicle from this fleet."
        );
      }

      let result = await this.fmsAccountHdlrImpl.MoveVehicleLogic(
        accountid,
        fromfleetid,
        tofleetid,
        vehicleid
      );
      APIResponseOK(req, res, result, "Vehicle moved from fleet successfully");
    } catch (error) {
      this.logger.error("MoveVehicle error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else if (
        error.errcode === "VEHICLE_NOT_FOUND_IN_SOURCE_FLEET" ||
        error.errcode === "VEHICLE_ALREADY_EXISTS_IN_TARGET_FLEET"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else {
        APIResponseInternalErr(req, res, error, {}, error.message);
      }
    }
  };

  RemoveVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        vehicleid: z
          .string({ message: "Invalid Vehicle ID format" })
          .nonempty({ message: "Invalid Vehicle ID format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "Vehicle ID can only contain letters, numbers, and spaces",
          }),
      });

      let { accountid, fleetid, vehicleid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
        vehicleid: req.params.vehicleid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["account.fleets.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to remove vehicle from this fleet."
        );
      }

      let result = await this.fmsAccountHdlrImpl.RemoveVehicleLogic(
        accountid,
        fleetid,
        vehicleid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle removed from fleet successfully"
      );
    } catch (error) {
      this.logger.error("RemoveVehicle error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (error.message === "VEHICLE_NOT_FOUND") {
        return APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Vehicle not found"
        );
      } else if (error.message === "FLEET_NOT_FOUND") {
        return APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Fleet not found"
        );
      } else if (error.message === "VEHICLE_ALREADY_IN_ROOT_FLEET") {
        return APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Vehicle already in root fleet"
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          null,
          "Failed to remove vehicle from fleet"
        );
      }
    }
  };

  ListMoveableFleets = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        vehicleid: z
          .string({ message: "Invalid Vehicle ID format" })
          .nonempty({ message: "Invalid Vehicle ID format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "Vehicle ID can only contain letters, numbers, and spaces",
          }),
        userid: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { accountid, vehicleid, userid } = validateAllInputs(schema, {
        accountid: req.accountid,
        vehicleid: req.params.vehicleid,
        userid: req.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.fleets.view",
          "account.fleets.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list moveable fleets."
        );
      }

      let result = await this.fmsAccountHdlrImpl.ListMoveableFleetsLogic(
        accountid,
        vehicleid,
        userid
      );
      APIResponseOK(req, res, result, "Moveable fleets fetched successfully");
    } catch (error) {
      this.logger.error("ListMoveableFleets error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (error.message === "VEHICLE_NOT_FOUND") {
        return APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Vehicle not found"
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          null,
          "Failed to list moveable fleets"
        );
      }
    }
  };

  // user management
  ListUsers = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
      });

      let { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.users.view",
          "account.users.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list users."
        );
      }

      let result = await this.fmsAccountHdlrImpl.ListUsersLogic(
        accountid,
        fleetid,
        recursive
      );
      APIResponseOK(req, res, result, "Users fetched successfully");
    } catch (error) {
      this.logger.error("ListUsers error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(req, res, error, "Failed to list users");
      }
    }
  };

  GetAssignableRoles = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),

        assignedby: z
          .string({ message: "Invalid Assignedby ID format" })
          .uuid({ message: "Invalid Assignedby ID format" }),
      });

      let { accountid, fleetid, userid, assignedby } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          userid: req.params.userid,
          assignedby: req.userid,
        }
      );

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.roles.admin",
          "account.roles.view",
          "account.users.admin",
          "account.users.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get assignable roles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetAssignableRolesLogic(
        accountid,
        fleetid,
        userid,
        assignedby
      );
      APIResponseOK(req, res, result, "Assignable roles fetched successfully");
    } catch (error) {
      this.logger.error("GetAssignableRoles error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          null,
          "Failed to get assignable roles"
        );
      }
    }
  };

  AssignUserRole = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        roleids: z
          .array(
            z
              .string({ message: "Invalid Role ID format" })
              .nonempty({ message: "Invalid Role ID format" })
              .uuid({ message: "Invalid Role ID format" })
          )
          .nonempty({ message: "At least one Role ID is required" }),
        assignedby: z
          .string({ message: "Invalid Assignedby ID format" })
          .uuid({ message: "Invalid Assignedby ID format" }),
      });

      let { accountid, fleetid, userid, roleids, assignedby } =
        validateAllInputs(schema, {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          userid: req.body.userid,
          roleids: req.body.roleids,
          assignedby: req.userid,
        });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(
          userPerms,
          ["account.users.admin", "account.roles.admin"],
          "all"
        )
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to assign user role."
        );
      }

      let result = await this.fmsAccountHdlrImpl.AssignUserRoleLogic(
        accountid,
        fleetid,
        userid,
        roleids,
        assignedby
      );
      APIResponseOK(req, res, result, "User role assigned successfully");
    } catch (error) {
      this.logger.error("AssignUserRole error: ", error);
      const validationErrorCodes = [
        "PERMISSION_DENIED",
        "FLEET_NOT_FOUND",
        "USER_NOT_IN_FLEET",
        "ROLE_INVALID",
        "ROLE_ALREADY_ASSIGNED",
        "ROLE_ASSIGNMENT_FAILED",
        "INPUT_ERROR",
        "INVALID_FLEET_ID_FORMAT",
        "ROOT_FLEET_NOT_FOUND",
      ];
      if (error.errcode && validationErrorCodes.includes(error.errcode)) {
        APIResponseBadRequest(req, res, error.errcode, {}, error.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          {},
          "Failed to assign user role"
        );
      }
    }
  };

  GetFleetUserRoleHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z.number({ message: "Invalid Start Time format" }),
        endtime: z.number({ message: "Invalid End Time format" }),
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        req.params.fleetid
      );

      let { accountid, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.accountid,
        starttime: Number(req.query.starttime || 0),
        endtime: Number(req.query.endtime || 0),
      });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 95 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 95 days"
        );
        return;
      }

      const startepoch = this.ValidateEpochTime(starttime, "starttime");
      const endepoch = this.ValidateEpochTime(endtime, "endtime");

      if (startepoch >= endepoch) {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Start time must be less than end time"
        );
      }

      if (endepoch - startepoch > 1000 * 60 * 60 * 24 * 100) {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Only 100 days of history is available"
        );
      }

      if (!CheckUserPerms(userPerms, ["account.users.view", "account.users.admin"])) {
        return APIResponseForbidden(
          req, 
          res, 
          "INSUFFICIENT_PERMISSIONS", 
          null, 
          "You don't have permission to get fleet user role history."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetFleetUserRoleHistoryLogic(
        accountid,
        starttime,
        endtime
      );
      APIResponseOK(req, res, result, "Fleet user role history fetched successfully");
    }
    catch (error) {
      this.logger.error("GetFleetUserRoleHistory error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, error.errcode, {}, error.message);
      } else {
        APIResponseInternalErr(req, res, error, "Failed to get fleet user role history");
      }
    }
  };

  DeassignUserRole = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),

        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),

        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Invalid Role ID format" }),

        deassignedby: z
          .string({ message: "Invalid DeassignedBy ID format" })
          .uuid({ message: "Invalid DeassignedBy ID format" }),
      });

      let { accountid, fleetid, userid, roleid, deassignedby } =
        validateAllInputs(schema, {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          userid: req.body.userid,
          roleid: req.body.roleid,
          deassignedby: req.userid,
        });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["account.users.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to deassign user role."
        );
      }

      let result = await this.fmsAccountHdlrImpl.DeassignUserRoleLogic(
        accountid,
        fleetid,
        userid,
        roleid,
        deassignedby
      );
      APIResponseOK(req, res, result, "User role deassigned successfully");
    } catch (error) {
      this.logger.error("DeassignUserRole error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND" ||
        error.errcode === "PERMISSION_DENIED" ||
        error.errcode === "ACCOUNT_ADMIN_CANNOT_REMOVE_OWN_ADMIN_ROLE" ||
        error.errcode === "ROLE_NOT_ASSIGNED" ||
        error.errcode === "ROLE_DEASSIGNMENT_FAILED" ||
        error.errcode === "CANNOT_REMOVE_LAST_ROLE"
      ) {
        APIResponseBadRequest(req, res, error.errcode, {}, error.message);
      } else {
        APIResponseInternalErr(req, res, error, "Failed to deassign user role");
      }
    }
  };

  GetUserInfo = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      let { accountid, fleetid, userid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
        userid: req.params.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.users.view",
          "account.users.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get user info."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetUserInfoLogic(
        accountid,
        fleetid,
        userid
      );
      APIResponseOK(req, res, result, "User info fetched successfully");
    } catch (error) {
      this.logger.error("GetUserInfo error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(req, res, error, "Failed to get user info");
      }
    }
  };

  RemoveUser = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        removedby: z
          .string({ message: "Invalid Removed By User ID format" })
          .uuid({ message: "Removed By User ID must be a valid UUID" }),
      });

      const { accountid, userid, removedby } = validateAllInputs(schema, {
        accountid: req.accountid,
        userid: req.params.userid,
        removedby: req.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.users.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to remove user."
        );
      }

      let result = await this.fmsAccountHdlrImpl.RemoveUserLogic(
        accountid,
        userid,
        removedby
      );

      APIResponseOK(req, res, result, "User removed from account successfully");
    } catch (error) {
      this.logger.error("RemoveUser error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "CANNOT_REMOVE_SELF" ||
        error.errcode === "USER_NOT_FOUND" ||
        error.errcode === "USER_NOT_IN_ACCOUNT" ||
        error.errcode === "CANNOT_REMOVE_LAST_ADMIN" ||
        error.errcode === "CANNOT_REMOVE_SEED_USER"
      ) {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "REMOVE_USER_ERR",
          error.toString(),
          "Remove user failed"
        );
      }
    }
  };

  GetAccountSubscriptions = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.view",
          "account.settings.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account subscriptions."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetAccountSubscriptionsLogic(
        accountid
      );
      APIResponseOK(req, res, result, "Subscriptions fetched successfully");
    } catch (error) {
      this.logger.error("GetAccountSubscriptions error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_SUBSCRIPTIONS_ERR",
          error.toString(),
          "Get subscriptions failed"
        );
      }
    }
  };

  CheckChangeSubscriptionPackage = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        newpkgid: z
          .string({ message: "Invalid New Package ID  ID format" })
          .uuid({ message: "Invalid  New Package ID format" }),
      });

      let { accountid, newpkgid } = validateAllInputs(schema, {
        accountid: req.accountid,
        newpkgid: req.body.newpkgid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.settings.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to check change subscription package."
        );
      }

      let result =
        await this.fmsAccountHdlrImpl.CheckChangeSubscriptionPackageLogic(
          accountid,
          newpkgid
        );
      APIResponseOK(
        req,
        res,
        result,
        "Check change subscription package success"
      );
    } catch (error) {
      this.logger.error("CheckChangeSubscriptionPackage error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.message === "INVALID_PACKAGE_ID" ||
        error.message === "NEW_PACKAGE_NOT_FOUND"
      ) {
        return APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Invalid package id or new package not found"
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CHECK_CHANGE_SUBSCRIPTION_PACKAGE_ERR",
          error.toString(),
          "Check change subscription package failed"
        );
      }
    }
  };

  UpdateAccountSubscription = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        updatedby: z
          .string({ message: "Invalid Updatedby ID format" })
          .uuid({ message: "Invalid Updatedby ID format" }),
        pkgid: z
          .string({ message: "Invalid Package ID  ID format" })
          .uuid({ message: "Invalid  Package ID format" }),
      });

      let { accountid, pkgid, updatedby } = validateAllInputs(schema, {
        updatedby: req.userid,
        accountid: req.accountid,
        pkgid: req.body.pkgid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.settings.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update account subscription."
        );
      }

      let result = await this.fmsAccountHdlrImpl.UpdateAccountSubscriptionLogic(
        accountid,
        pkgid,
        updatedby
      );
      APIResponseOK(req, res, result, "Subscription updated successfully");
    } catch (error) {
      this.logger.error("UpdateAccountSubscription error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "INVALID_PACKAGE_ID" ||
        error.errcode === "ACCOUNT_ALREADY_SUBSCRIBED_TO_THIS_PACKAGE"
      ) {
        APIResponseBadRequest(req, res, error.errcode, {}, error.message);
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          "Failed to update account subscription"
        );
      }
    }
  };

  GetSubscriptionHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.view",
          "account.settings.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get subscription history."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetSubscriptionHistoryLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Subscription history fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetSubscriptionHistory error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          "Failed to get subscription history"
        );
      }
    }
  };

  GetSubscriptionVehicles = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.view",
          "account.settings.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get subscription vehicles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetSubscriptionVehiclesLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Subscription vehicles fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetSubscriptionVehicles error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          "Failed to get subscription vehicles"
        );
      }
    }
  };

  GetSubscriptionVehiclesHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });
      let convertedstarttime = parseInt(req.query.starttime);
      let convertedendtime = parseInt(req.query.endtime);

      let { accountid, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.accountid,
        starttime: convertedstarttime,
        endtime: convertedendtime,
      });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 95 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 95 days"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.view",
          "account.settings.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get subscription vehicles."
        );
      }

      let result =
        await this.fmsAccountHdlrImpl.GetSubscriptionVehiclesHistoryLogic(
          accountid,
          starttime,
          endtime
        );
      APIResponseOK(
        req,
        res,
        result,
        "Subscription vehicles history fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetSubscriptionVehiclesHistory error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          "Failed to get subscription vehicles history"
        );
      }
    }
  };

  CreateSubscriptionIntent = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        vinnos: z
          .array(
            z
              .string({ message: "VIN No must be a string" })
              .min(1, { message: "VIN No cannot be empty" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message: "VIN No can only contain letters, numbers, and spaces",
              })
              .max(128, {
                message: "VIN No must be at most 128 characters long",
              })
          )
          .min(1, { message: "VINs array must contain at least one VIN" }),

        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { accountid, vinnos, userid } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinnos: req.body.vinnos,
        userid: req.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.settings.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create subscription intent."
        );
      }

      let result = await this.fmsAccountHdlrImpl.CreateSubscriptionIntentLogic(
        accountid,
        vinnos,
        userid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Subscription intent created successfully"
      );
    } catch (error) {
      this.logger.error("CreateSubscriptionIntent error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          "Failed to create subscription intent"
        );
      }
    }
  };

  SubscribeVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        vinnos: z
          .array(
            z
              .string({ message: "VIN No must be a string" })
              .min(1, { message: "VIN No cannot be empty" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message: "VIN No can only contain letters, numbers, and spaces",
              })
          )
          .min(1, { message: "VINs array must contain at least one VIN" }),

        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { accountid, vinnos, userid } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinnos: req.body.vinnos,
        userid: req.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.settings.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to subscribe vehicles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.SubscribeVehicleLogic(
        accountid,
        vinnos,
        userid
      );

      if (result.status === "error") {
        APIResponseBadRequest(
          req,
          res,
          "SUBSCRIPTION_FAILED",
          result.message,
          result.details
        );
        return;
      }

      APIResponseOK(req, res, result, "Vehicles subscribed successfully");
    } catch (error) {
      this.logger.error("SubscribeVehicle error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(req, res, error, "Failed to subscribe vehicles");
      }
    }
  };

  UnsubscribeVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        vinnos: z
          .array(
            z
              .string({ message: "VIN No must be a string" })
              .min(1, { message: "VIN No cannot be empty" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message: "VIN No can only contain letters, numbers, and spaces",
              })
              .max(128, {
                message: "VIN No must be at most 128 characters long",
              })
          )
          .min(1, { message: "VINs array must contain at least one VIN" }),

        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { accountid, vinnos, userid } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinnos: req.body.vinnos,
        userid: req.userid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.settings.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to unsubscribe vehicles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.UnsubscribeVehicleLogic(
        accountid,
        vinnos,
        userid
      );

      // Check if the result has an error status
      if (result.status === "error") {
        // If there are vehicle-wise results, return them with the error
        if (result.vinresults && result.vinresults.length > 0) {
          APIResponseBadRequest(
            req,
            res,
            "UNSUBSCRIPTION_FAILED",
            result.message,
            {
              vinresults: result.vinresults,
              summary: result.summary || {},
            }
          );
          return;
        }

        // If no vehicle-wise results, return general error
        APIResponseBadRequest(
          req,
          res,
          "UNSUBSCRIPTION_FAILED",
          result.message,
          result.details || {}
        );
        return;
      }

      APIResponseOK(req, res, result, "Vehicles unsubscribed successfully");
    } catch (error) {
      this.logger.error("UnsubscribeVehicle error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          null,
          "Failed to unsubscribe vehicles"
        );
      }
    }
  };

  GetAccountCredits = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });
      const { userid, accountid } = validateAllInputs(schema, {
        userid: req.userid,
        accountid: req.accountid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.admin",
          "account.settings.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account credits."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetAccountCreditsLogic(
        accountid
      );
      APIResponseOK(req, res, result, "Account credits fetched successfully");
    } catch (error) {
      this.logger.error("GetAccountCredits error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_CREDITS_ERR",
          error.toString(),
          "Get account credits failed"
        );
      }
    }
  };

  GetAccountCreditsHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });

      const { userid, accountid, starttime, endtime } = validateAllInputs(
        schema,
        {
          userid: req.userid,
          accountid: req.accountid,
          starttime: Number(req.query.starttime || 0),
          endtime: Number(req.query.endtime || 0),
        }
      );

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 95 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 95 days"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.admin",
          "account.settings.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account credits history."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetAccountCreditsHistoryLogic(
        accountid,
        starttime,
        endtime
      );
      APIResponseOK(
        req,
        res,
        result,
        "Account credits history fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetAccountCreditsHistory error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_CREDITS_HISTORY_ERR",
          error.toString(),
          "Get account credits history failed"
        );
      }
    }
  };

  GetAccountCreditsOverview = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });

      const { userid, accountid, starttime, endtime } = validateAllInputs(
        schema,
        {
          userid: req.userid,
          accountid: req.accountid,
          starttime: Number(req.query.starttime || 0),
          endtime: Number(req.query.endtime || 0),
        }
      );

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 1000 * 60 * 60 * 24 * 95) {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Time range is too long selected range should be <= 95 days"
        );
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.admin",
          "account.settings.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account credits overview."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetAccountCreditsOverviewLogic(
        accountid,
        starttime,
        endtime
      );
      APIResponseOK(
        req,
        res,
        result,
        "Account credits overview fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetAccountCreditsOverview error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_CREDITS_OVERVIEW_ERR",
          error.toString(),
          "Get account credits overview failed"
        );
      }
    }
  };

  GetAccountVehicleCreditsHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .min(1, { message: "VIN No cannot be empty" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });

      const { userid, accountid, vinno, fleetid, starttime, endtime } =
        validateAllInputs(schema, {
          userid: req.userid,
          accountid: req.accountid,
          vinno: req.params.vinno,
          fleetid: req.query.fleetid,
          starttime: Number(req.query.starttime || 0),
          endtime: Number(req.query.endtime || 0),
        });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 1000 * 60 * 60 * 24 * 95) {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Time range is too long selected range should be <= 95 days"
        );
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.admin",
          "account.settings.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account vehicle credits history."
        );
      }

      let result =
        await this.fmsAccountHdlrImpl.GetAccountVehicleCreditsHistoryLogic(
          accountid,
          vinno,
          fleetid,
          starttime,
          endtime
        );
      APIResponseOK(
        req,
        res,
        result,
        "Account vehicle credits history fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetAccountVehicleCreditsHistory error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          null,
          "Failed to get account vehicle credits history"
        );
      }
    }
  };

  GetAccountFleetCreditsHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });

      const { userid, accountid, fleetid, starttime, endtime, recursive } =
        validateAllInputs(schema, {
          userid: req.userid,
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          starttime: Number(req.query.starttime || 0),
          endtime: Number(req.query.endtime || 0),
          recursive: req.query.recursive === "true",
        });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 1000 * 60 * 60 * 24 * 95) {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Time range is too long selected range should be <= 95 days"
        );
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid,
        fleetid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.settings.admin",
          "account.settings.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account fleet credits history."
        );
      }

      let result =
        await this.fmsAccountHdlrImpl.GetAccountFleetCreditsHistoryLogic(
          accountid,
          fleetid,
          starttime,
          endtime,
          recursive
        );
      APIResponseOK(
        req,
        res,
        result,
        "Account fleet credits history fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetAccountFleetCreditsHistory error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          null,
          "Failed to get account fleet credits history"
        );
      }
    }
  };

  TagVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        taggedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        dstaccountid: z
          .string({ message: "Invalid Destination Account ID format" })
          .uuid({ message: "Invalid Destination Account ID format" }),
        vinnos: z
          .array(
            z
              .string({ message: "VIN No must be a string" })
              .min(1, { message: "VIN No cannot be empty" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message: "VIN No can only contain letters, numbers, and spaces",
              })
              .max(128, {
                message: "VIN No must be at most 128 characters long",
              })
          )
          .min(1, { message: "VINs array must contain at least one VIN" }),
        allow_retag: z
          .boolean({ message: "allow_retag must be a boolean" })
          .default(false),
      });

      let { taggedby, accountid, dstaccountid, vinnos, allow_retag } =
        validateAllInputs(schema, {
          taggedby: req.userid,
          accountid: req.accountid,
          dstaccountid: req.body.dstaccountid,
          vinnos: req.body.vinnos,
          allow_retag: req.body.allow_retag,
        });

      // Validate that source and destination accounts are different
      if (accountid === dstaccountid) {
        return APIResponseBadRequest(
          req,
          res,
          "SAME_ACCOUNT_ERROR",
          null,
          "Source and destination accounts cannot be the same"
        );
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.settings.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to tag vehicles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.TagVehicleLogic(
        accountid,
        dstaccountid,
        vinnos,
        allow_retag,
        taggedby
      );

      if (result.status === "error") {
        APIResponseBadRequest(
          req,
          res,
          "TAG_VEHICLE_FAILED",
          result.message,
          result
        );
        return;
      }

      APIResponseOK(req, res, result, "Vehicles tagged successfully");
    } catch (error) {
      this.logger.error("TagVehicle error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(req, res, error, null, "Failed to tag vehicles");
      }
    }
  };

  UntagVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        untaggedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        dstaccountid: z
          .string({ message: "Invalid Destination Account ID format" })
          .uuid({ message: "Invalid Destination Account ID format" }),
        vinnos: z
          .array(
            z
              .string({ message: "VIN No must be a string" })
              .min(1, { message: "VIN No cannot be empty" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message: "VIN No can only contain letters, numbers, and spaces",
              })
              .max(128, {
                message: "VIN No must be at most 128 characters long",
              })
          )
          .min(1, { message: "VINs array must contain at least one VIN" }),
      });

      let { untaggedby, accountid, dstaccountid, vinnos } = validateAllInputs(
        schema,
        {
          untaggedby: req.userid,
          accountid: req.accountid,
          dstaccountid: req.body.dstaccountid,
          vinnos: req.body.vinnos,
        }
      );

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (!CheckUserPerms(userPerms, ["account.settings.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to untag vehicles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.UntagVehicleLogic(
        accountid,
        dstaccountid,
        vinnos,
        untaggedby
      );

      if (result.status === "error") {
        APIResponseBadRequest(
          req,
          res,
          "UNTAG_VEHICLE_FAILED",
          result.message,
          result
        );
        return;
      }

      APIResponseOK(req, res, result, "Vehicles untagged successfully");
    } catch (error) {
      this.logger.error("UntagVehicle error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          error.errdata,
          error.message
        );
      } else if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          "Fleet not found or does not belong to this account"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          error,
          null,
          "Failed to untag vehicles"
        );
      }
    }
  };

  GetTaggedOutVehicles = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.fleets.view",
          "account.fleets.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to view shared vehicles."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetSharedVehiclesLogic(
        accountid
      );
      APIResponseOK(req, res, result, "Shared vehicles fetched successfully");
    } catch (error) {
      this.logger.error("GetTaggedOutVehicles error: ", error);
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
          error,
          null,
          "Failed to get shared vehicles"
        );
      }
    }
  };

  GetSharedAccounts = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),
      });

      let { accountid, vinno } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinno: req.params.vinno,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.fleets.view",
          "account.fleets.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to view shared accounts."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetSharedAccountsLogic(
        accountid,
        vinno
      );
      APIResponseOK(req, res, result, "Shared accounts fetched successfully");
    } catch (error) {
      this.logger.error("GetSharedAccounts error: ", error);
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
          error,
          null,
          "Failed to get shared accounts"
        );
      }
    }
  };

  GetTaggedInVehicles = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.accountid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        accountid
      );

      if (
        !CheckUserPerms(userPerms, [
          "account.fleets.view",
          "account.fleets.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to view vehicles shared to this account."
        );
      }

      let result = await this.fmsAccountHdlrImpl.GetVehiclesSharedToMeLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicles shared to account fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetVehiclesSharedToMe error: ", error);
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
          error,
          null,
          "Failed to get vehicles shared to account"
        );
      }
    }
  };

  GetMyFleetPermissions = async (req, res, next) => {
    try {
      const schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
      });

      const { userid, accountid, fleetid } = validateAllInputs(schema, {
        userid: req.userid,
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });

      const result = await this.fmsAccountHdlrImpl.GetMyFleetPermissionsLogic(
        userid,
        accountid,
        fleetid
      );

      APIResponseOK(
        req,
        res,
        result,
        "Fleet permissions retrieved successfully"
      );
    } catch (error) {
      this.logger.error("GetMyFleetPermissions error: ", error);
      if (error.errcode === "FLEET_NOT_FOUND") {
        APIResponseBadRequest(
          req,
          res,
          "FLEET_NOT_FOUND",
          error.errdata,
          error.message
        );
      } else if (error.errcode === "USER_NOT_IN_FLEET") {
        APIResponseBadRequest(
          req,
          res,
          "USER_NOT_IN_FLEET",
          error.errdata,
          error.message
        );
      } else if (error.errcode === "INPUT_ERROR") {
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
          "GET_FLEET_PERMISSIONS_ERR",
          error.toString(),
          "Get fleet permissions failed"
        );
      }
    }
  };

  GetAccountAssignmentHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z.number({ message: "Invalid Start Time format" }),
        endtime: z.number({ message: "Invalid End Time format" }),
      });

      let { accountid, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.accountid,
        starttime: Number(req.query.starttime || 0),
        endtime: Number(req.query.endtime || 0),
      });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 95 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 95 days"
        );
        return;
      }

      const startepoch = this.ValidateEpochTime(starttime, "starttime");
      const endepoch = this.ValidateEpochTime(endtime, "endtime");

      if (startepoch >= endepoch) {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Start time must be less than end time"
        );
      }

      if (endepoch - startepoch > 1000 * 60 * 60 * 24 * 100) {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Only 100 days of history is available"
        );
      }

      let result =
        await this.fmsAccountHdlrImpl.GetAccountAssignmentHistoryLogic(
          accountid,
          startepoch,
          endepoch
        );
      APIResponseOK(
        req,
        res,
        result,
        "Account assignment history fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetAccountAssignmentHistory error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "GET_ACCOUNT_ASSIGNMENT_HISTORY_ERR",
        e.toString(),
        "Get account assignment history failed"
      );
    }
  };
}
