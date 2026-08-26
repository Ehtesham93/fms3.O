import crypto from "crypto";
import { UAParser } from "ua-parser-js";
import z from "zod";
import {
  UUID_PATTERN,
  CUSTOMER_TYPE_INDIVIDUAL,
  CUSTOMER_TYPE_CORPORATE,
} from "../../../utils/constant.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseError,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import PUserHdlrImpl from "./puserhdlr_impl.js";
import { parseQueryInt } from "../../../utils/commonutil.js";

const RATE_LIMIT_PER_HOUR = 3;
export default class PUserHdlr {
  constructor(
    pUserSvcI,
    userSvcI,
    accountSvcI,
    fmsAccountSvcI,
    authSvcI,
    platformSvcI,
    accountHdlr,
    inMemCacheI,
    logger
  ) {
    this.pUserSvcI = pUserSvcI;
    this.userSvcI = userSvcI;
    this.accountSvcI = accountSvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.authSvcI = authSvcI;
    this.platformSvcI = platformSvcI;
    this.logger = logger;
    this.pUserHdlrImpl = new PUserHdlrImpl(
      pUserSvcI,
      userSvcI,
      accountSvcI,
      fmsAccountSvcI,
      authSvcI,
      platformSvcI,
      accountHdlr,
      logger
    );
    this.inMemCacheI = inMemCacheI;
  }

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

  getPlatformInviteFingerprint = (req, contact, roleids) => {
    const deviceFingerprint = this.getDeviceFingerprint(req);
    const platformAccountId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const sortedRoleIds = roleids.sort().join(",");
    const inviteSpecificData = `${deviceFingerprint}-${platformAccountId}-${contact}-${sortedRoleIds}`;
    const inviteFingerprint = crypto
      .createHash("sha256")
      .update(inviteSpecificData)
      .digest("hex");

    return inviteFingerprint;
  };

  RegisterRoutes(router) {
    router.get("/list", this.ListUsers);
    router.post("/invite", this.InvitePlatformUser);
    router.get("/invites", this.ListPlatformInvites);
    router.post("/invite/resend", this.ResendPlatformInvite);
    router.post("/invite/cancel", this.CancelPlatformInvite);
    router.get(`/:userid(${UUID_PATTERN})`, this.GetUser);
    router.post(`/:userid(${UUID_PATTERN})/enable`, this.EnableUser);
    router.post(`/:userid(${UUID_PATTERN})/disable`, this.DisableUser);
    router.get(`/:userid(${UUID_PATTERN})/accounts`, this.ListUserAccounts);
    router.get(
      `/:userid(${UUID_PATTERN})/assignableroles`,
      this.ListAssignableUserRoles
    );
    router.post(`/:userid(${UUID_PATTERN})/role`, this.AddUserPlatformRole);
    router.delete(
      `/:userid(${UUID_PATTERN})/role/:roleid`,
      this.RemoveUserPlatformRole
    );

    router.post("/createadmin", this.CreateSuperAdmin);
    router.post("/createuser", this.CreateUserByPlatformAdmin);
    router.post("/account/adduser", this.AddUserToAccount);
    router.delete(
      "/account/:accountid/user/:contact",
      this.RemoveUserFromAccount
    );
    router.delete(`/:userid(${UUID_PATTERN})`, this.DeleteUser);

    router.put(
      `/:userid(${UUID_PATTERN})/resetuserpassword`,
      this.ResetUserPassword
    );
    router.get("/getmyperms", this.GetMyConsolePermissions);
    router.get("/metadata-options", this.GetMetadataOptions);
    router.post("/onboarduseraccount", this.OnboardUserAccount);
    router.post("/compositeonboardapi", this.CompositeOnboardAPI);

    router.get("/listpending", this.ListPendingUsers);
    router.get("/listdone", this.ListDoneUsers);
    router.post("/retryonboard", this.RetryOnboard);
    router.post("/getuseraccountlist", this.GetUserAccountList);
    router.post("/createadminuser", this.CreateAdminUser);
    router.post("/userdetails", this.UserDetailsByErrorCode);
  }

  CreateUser = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create user."
      );
    }
    try {
      let schema = z.object({
        createdby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        email: z
          .string({ message: "Invalid Email format" })
          .email({ message: "Invalid email format" }),
        password: z
          .string({ message: "Password is required" })
          .nonempty({ message: "Password cannot be empty" })
          .min(8, { message: "Password must be at least 6 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
        mobile: z
          .string({ message: "Invalid Mobile Number format" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          }),
        displayname: z
          .string({ message: "Invalid Display Name format" })
          .nonempty({ message: "Display Name cannot be empty" })
          .max(128, {
            message: "Display Name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Display Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });

      let { createdby, password, displayname, email, mobile } =
        validateAllInputs(schema, {
          createdby: req.userid,
          password: req.body.password,
          displayname: req.body.displayname,
          email: req.body.email,
          mobile: req.body.mobile,
        });

      let result = await this.pUserHdlrImpl.CreateUserLogic(
        displayname,
        email,
        password,
        mobile,
        createdby
      );

      APIResponseOK(req, res, result, "User created successfully");
    } catch (e) {
      this.logger.error("CreateUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_USER_ERR",
          e.toString(),
          "Create user failed"
        );
      }
    }
  };

  InvitePlatformUser = async (req, res, next) => {
    try {
      const invitedby = req.userid;
      const schema = z.object({
        contact: z
          .string({ message: "Invalid Contact format" })
          .nonempty({ message: "Contact is required" })
          .refine(
            (val) =>
              /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val) ||
              /^[6-9]\d{9}$/.test(val),
            {
              message:
                "Contact must be a valid email address or Indian mobile number (10 digits starting with 6-9)",
            }
          ),
        roleids: z
          .array(z.string({ message: "Invalid Role Ids format" }))
          .nonempty({ message: "At least one role ID is required" }),
      });

      let { contact, roleids } = validateAllInputs(schema, {
        contact: req.body.contact,
        roleids: req.body.roleids || [],
      });

      const inviteFingerprint = this.getPlatformInviteFingerprint(
        req,
        contact,
        roleids
      );
      const rateLimitKey = `platform_invite_rate_limit:${inviteFingerprint}`;

      let currentCount = this.inMemCacheI.get(rateLimitKey) || 0;

      if (currentCount >= RATE_LIMIT_PER_HOUR) {
        const error = new Error(
          "Too many platform invites sent to this contact with these roles. Please try after an hour."
        );
        error.errcode = "RATE_LIMIT_EXCEEDED";
        throw error;
      }

      let headerReferer = req.headers.origin;

      let result;
      if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(contact)) {
        result = await this.pUserHdlrImpl.InvitePlatformUserLogic(
          contact,
          roleids,
          invitedby,
          headerReferer
        );
      } else {
        throw new Error("Not a valid email address");
      }
      this.inMemCacheI.set(rateLimitKey, currentCount + 1);
      APIResponseOK(req, res, result, "User invited successfully");
    } catch (e) {
      this.logger.error("InvitePlatformUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "RATE_LIMIT_EXCEEDED") {
        APIResponseError(
          req,
          res,
          429,
          "RATE_LIMIT_EXCEEDED",
          null,
          "Too many platform invites sent to this contact with these roles. Please try after an hour."
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "INVITE_PLATFORM_USER_ERR",
          e.toString(),
          "Invite platform user failed"
        );
      }
    }
  };

  ListPlatformInvites = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.userid,
      });

      let result = await this.pUserHdlrImpl.ListPlatformInvitesLogic(userid);
      APIResponseOK(req, res, result, "Platform invites fetched successfully");
    } catch (e) {
      this.logger.error("ListPlatformInvites error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_PLATFORM_INVITES_ERR",
          e.toString(),
          "List platform invites failed"
        );
      }
    }
  };

  CancelPlatformInvite = async (req, res, next) => {
    try {
      const schema = z.object({
        inviteid: z
          .string({ message: "Invalid Invite ID format" })
          .uuid({ message: "Invite ID must be a valid UUID" }),
      });

      const { inviteid } = validateAllInputs(schema, {
        inviteid: req.body.inviteid,
      });

      let result = await this.pUserHdlrImpl.CancelPlatformInviteLogic(
        inviteid,
        req.userid
      );
      APIResponseOK(req, res, result, "Platform invite cancelled successfully");
    } catch (e) {
      this.logger.error("CancelPlatformInvite error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "INVALID_INVITE_ID" ||
        e.errcode === "INVITE_NOT_IN_SENT_STATE" ||
        e.errcode === "INVITE_NOT_AN_EMAIL_INVITE" ||
        e.errcode === "CANNOT_CANCEL_AN_EXPIRED_INVITE"
      ) {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CANCEL_PLATFORM_INVITE_ERR",
          e.toString(),
          "Cancel platform invite failed"
        );
      }
    }
  };

  ResendPlatformInvite = async (req, res, next) => {
    try {
      let schema = z.object({
        inviteid: z
          .string({ message: "Invalid Invite ID format" })
          .uuid({ message: "Invalid Invite ID format" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });
      let { inviteid, userid } = validateAllInputs(schema, {
        inviteid: req.body.inviteid,
        userid: req.userid,
      });

      const deviceFingerprint = this.getDeviceFingerprint(req);
      const resendFingerprint = crypto
        .createHash("sha256")
        .update(`${deviceFingerprint}-${inviteid}`)
        .digest("hex");
      const rateLimitKey = `platform_invite_resend_rate_limit:${resendFingerprint}`;

      let currentCount = this.inMemCacheI.get(rateLimitKey) || 0;

      if (currentCount >= RATE_LIMIT_PER_HOUR) {
        const error = new Error(
          "Too many platform invites sent to this contact with these roles. Please try after an hour."
        );
        error.errcode = "RATE_LIMIT_EXCEEDED";
        throw error;
      }

      let headerReferer = req.headers.origin;
      let result = await this.pUserHdlrImpl.ResendPlatformInviteLogic(
        inviteid,
        userid,
        headerReferer
      );
      this.inMemCacheI.set(rateLimitKey, currentCount + 1);
      APIResponseOK(req, res, result, "Platform invite resent successfully");
    } catch (e) {
      this.logger.error("ResendPlatformInvite error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "RATE_LIMIT_EXCEEDED") {
        APIResponseError(
          req,
          res,
          429,
          "RATE_LIMIT_EXCEEDED",
          null,
          "Too many platform invites sent to this contact with these roles. Please try after an hour."
        );
      } else if (
        e.errcode === "INVALID_INVITE_ID" ||
        e.errcode === "INVITE_NOT_IN_SENT_STATE" ||
        e.errcode === "INVITE_NOT_AN_EMAIL_INVITE" ||
        e.errcode === "CANNOT_RESEND_AN_EXPIRED_INVITE" ||
        e.errcode === "ACCOUNT_NOT_FOUND" ||
        e.errcode === "FLEET_NOT_FOUND"
      ) {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "RESEND_PLATFORM_INVITE_ERR",
          e.errdata,
          "Resend platform invite failed"
        );
      }
    }
  };

  ListUsers = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.user.admin",
          "consolemgmt.user.view",
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
      const schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine((val) => !val || val.length === 0 || val.length >= 3, {
            message: "Search text must be at least 3 characters long",
          }),
        roletype: z
          .enum(["platform", "account"], { message: "Invalid Role Type" })
          .optional()
          .or(z.literal("").transform(() => undefined)),
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(1000),
        download: z
          .boolean({ message: "Download must be a boolean" })
          .optional()
          .default(false),
        orderbyfield: z
          .string({ message: "Order by field is required" })
          .optional()
          .nullable()
          .default("lastloginat"),
        orderbydirection: z
          .string({ message: "Order by direction is required" })
          .optional()
          .nullable()
          .default("desc"),
      });
      const parseDownload = req.query.download === "true";
      const {
        searchtext,
        roletype,
        offset,
        limit,
        download,
        orderbyfield,
        orderbydirection,
      } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        roletype: req.query.roletype,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        download: parseDownload,
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
      });

      let result;
      if (roletype === "platform") {
        result = await this.pUserHdlrImpl.ListPlatformUsersLogic(
          searchtext,
          offset,
          limit,
          download,
          orderbyfield,
          orderbydirection
        );
      } else if (roletype === "account") {
        result = await this.pUserHdlrImpl.ListAccountUsersLogic(
          searchtext,
          offset,
          limit,
          download,
          orderbyfield,
          orderbydirection
        );
      } else {
        result = await this.pUserHdlrImpl.ListUsersLogic(
          searchtext,
          offset,
          limit,
          download,
          orderbyfield,
          orderbydirection
        );
      }

      APIResponseOK(req, res, result, "Users fetched successfully");
    } catch (e) {
      this.logger.error("ListUsers error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_USERS_ERR",
          e.toString(),
          "List users failed"
        );
      }
    }
  };

  GetUser = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.user.admin",
        "consolemgmt.user.view",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get user."
      );
    }
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });
      let { userid } = validateAllInputs(schema, {
        userid: req.params.userid,
      });
      let result = await this.pUserHdlrImpl.GetUserLogic(userid);
      APIResponseOK(req, res, result, "User fetched successfully");
    } catch (e) {
      this.logger.error("GetUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_USER_ERR",
          e.toString(),
          "Get user failed"
        );
      }
    }
  };

  ListAssignableUserRoles = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.user.admin",
        "consolemgmt.user.view",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to list user roles."
      );
    }
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.params.userid,
      });

      let result = await this.pUserHdlrImpl.ListAssignableUserRolesLogic(
        userid
      );

      APIResponseOK(
        req,
        res,
        result,
        "Unassigned user roles fetched successfully"
      );
    } catch (e) {
      this.logger.error("ListAssignableUserRoles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_UNASSIGNED_USER_ROLES_ERR",
          e.toString(),
          "List unassigned user roles failed"
        );
      }
    }
  };

  EnableUser = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to enable user."
      );
    }
    try {
      const schema = z.object({
        updatedby: z
          .string({ message: "Invalid Token format" })
          .uuid({ message: "Invalid Token ID format" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });
      let { updatedby, userid } = validateAllInputs(schema, {
        updatedby: req.userid,
        userid: req.params.userid,
      });

      let result = await this.pUserHdlrImpl.EnableUserLogic(userid, updatedby);
      APIResponseOK(req, res, result, "User enabled successfully");
    } catch (e) {
      this.logger.error("EnableUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ENABLE_USER_ERR",
          e.toString(),
          "Enable user failed"
        );
      }
    }
  };

  DisableUser = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to disable user."
      );
    }
    try {
      const schema = z.object({
        updatedby: z
          .string({ message: "Invalid Token format" })
          .uuid({ message: "Invalid UUID format" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid UUID format" }),
      });

      let { updatedby, userid } = validateAllInputs(schema, {
        updatedby: req.userid,
        userid: req.params.userid,
      });
      let result = await this.pUserHdlrImpl.DisableUserLogic(userid, updatedby);
      APIResponseOK(req, res, result, "User disabled successfully");
    } catch (e) {
      this.logger.error("DisableUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "DISABLE_USER_ERR",
          e.toString(),
          "Disable user failed"
        );
      }
    }
  };

  ListUserAccounts = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.user.admin",
        "consolemgmt.user.view",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to list user accounts."
      );
    }
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User UUID format" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.params.userid,
      });

      let result = await this.pUserHdlrImpl.ListUserAccountsLogic(userid);
      APIResponseOK(req, res, result, "User accounts fetched successfully");
    } catch (e) {
      this.logger.error("ListUserAccounts error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_USER_ACCOUNTS_ERR",
          e.toString(),
          "List user accounts failed"
        );
      }
    }
  };

  AddUserPlatformRole = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to add user platform role."
      );
    }
    try {
      const updatedby = req.userid;

      const schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        roleids: z
          .array(
            z
              .string({ message: "Each Role ID must be a valid string" })
              .max(120)
          )
          .nonempty({ message: "At least one role ID is required" }),

        roletype: z.literal("platform", {
          errorMap: () => ({
            message: "Invalid role type — only 'platform' is allowed",
          }),
        }),
      });

      const { userid, roleids, roletype } = validateAllInputs(schema, {
        userid: req.params.userid,
        roleids: req.body.roleids || [],
        roletype: req.body.roletype,
      });

      const result = await this.pUserHdlrImpl.AddUserPlatformRoleLogic(
        userid,
        roleids,
        updatedby
      );

      APIResponseOK(req, res, result, "User role added successfully");
    } catch (e) {
      this.logger.error("AddUserPlatformRole error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "ADD_USER_PLATFORM_ROLE_ERR",
          e.toString(),
          "Add user platform role failed"
        );
      }
    }
  };

  RemoveUserPlatformRole = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to remove user platform role."
      );
    }
    try {
      let schema = z.object({
        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        userid: z
          .string({ message: "Invalid Target User ID format" })
          .uuid({ message: "Target User ID must be a valid UUID" }),

        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" }),
      });

      let { updatedby, userid, roleid } = validateAllInputs(schema, {
        updatedby: req.userid,
        userid: req.params.userid,
        roleid: req.params.roleid,
      });

      let result = await this.pUserHdlrImpl.RemoveUserPlatformRoleLogic(
        userid,
        roleid,
        updatedby
      );

      APIResponseOK(req, res, result, "User role removed successfully");
    } catch (e) {
      this.logger.error("RemoveUserPlatformRole error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "CANNOT_REMOVE_SUPER_ADMIN_ROLE") {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
        return;
      } else {
        APIResponseInternalErr(
          req,
          res,
          "REMOVE_USER_PLATFORM_ROLE_ERR",
          e.toString(),
          "Remove user platform role failed"
        );
      }
    }
  };

  CreateSuperAdmin = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create super admin."
      );
    }
    try {
      let schema = z.object({
        email: z
          .string({ message: "Invalid Email format" })
          .email({ message: "Invalid Email format" }),
        password: z
          .string({ message: "Password is required" })
          .nonempty({ message: "Password cannot be empty" })
          .min(8, { message: "Password must be at least 6 characters long" })
          .max(128, { message: "Password must not exceed 128 characters" }),
      });

      let { email, password } = validateAllInputs(schema, req.body);

      let result = await this.pUserHdlrImpl.CreateSuperAdminLogic(
        req.userid,
        email,
        password
      );

      APIResponseOK(req, res, result, "Super Admin created successfully");
    } catch (e) {
      this.logger.error("CreateSuperAdmin error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_SUPER_ADMIN_ERR",
          e.toString(),
          "Create Super Admin failed"
        );
      }
    }
  };

  CreateUserByPlatformAdmin = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create user."
      );
    }
    try {
      let baseSchema = z.object({
        forceuseridtypeverified: z.boolean({
          message: "forceuseridtypeverified must be a boolean",
        }),

        displayname: z
          .string({ message: "Invalid Display Name format" })
          .nonempty({ message: "Display Name cannot be empty" })
          .max(128, { message: "Display Name must be at most 128 characters" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Display Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),

        userinfo: z
          .record(z.any(), { message: "userinfo must be an object" })
          .default({}),

        createdby: z
          .string({ message: "Invalid creator ID format" })
          .uuid({ message: "Creator ID must be a valid UUID" }),
      });

      let schema = z.discriminatedUnion("useridtype", [
        baseSchema.extend({
          useridtype: z.literal("email"),
          contact: z
            .string({ message: "Invalid email format" })
            .email({ message: "Contact must be a valid email address" }),
        }),
        baseSchema.extend({
          useridtype: z.literal("mobile"),
          contact: z
            .string({ message: "Invalid mobile number format" })
            .regex(/^[6-9]\d{9}$/, {
              message:
                "Mobile must be a valid Indian mobile number (10 digits starting with 6-9)",
            }),
        }),
      ]);

      let {
        useridtype,
        forceuseridtypeverified,
        contact,
        displayname,
        userinfo,
        createdby,
      } = validateAllInputs(schema, {
        useridtype: req.body.useridtype,
        forceuseridtypeverified: req.body.forceuseridtypeverified,
        contact: req.body.contact,
        displayname: req.body.displayname,
        userinfo: req.body.userinfo,
        createdby: req.userid,
      });

      let result = await this.pUserHdlrImpl.CreateUserByPlatformAdminLogic(
        useridtype,
        forceuseridtypeverified,
        contact,
        displayname,
        userinfo,
        createdby
      );

      APIResponseOK(req, res, result, "User created successfully");
    } catch (e) {
      this.logger.error("CreateUserByPlatformAdmin error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_USER_ERR",
          e.toString(),
          "Create user failed"
        );
      }
    }
  };

  AddUserToAccount = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to add user to account."
      );
    }
    try {
      const addedby = req.userid;
      const contact = req.body.contact;
      const accountid = req.body.accountid;
      let result = await this.pUserHdlrImpl.AddUserToAccountLogic(
        addedby,
        contact,
        accountid
      );
      APIResponseOK(req, res, result, "User added to account successfully");
    } catch (e) {
      this.logger.error("AddUserToAccount error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "ADD_USER_TO_ACCOUNT_ERR",
        e.toString(),
        "Add user to account failed"
      );
    }
  };

  RemoveUserFromAccount = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to remove user from account."
      );
    }
    try {
      let schema = z.object({
        removedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
        contact: z
          .string({ message: "Contact must be a string" })
          .nonempty({ message: "Contact cannot be empty" })
          .refine(
            (val) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ||
              /^[6-9]\d{9}$/.test(val),
            {
              message:
                "Invalid contact format. Please provide a valid email or mobile number.",
            }
          ),

        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Account ID must be a valid UUID" }),
      });

      let { removedby, contact, accountid } = validateAllInputs(schema, {
        removedby: req.userid,
        contact: req.params.contact,
        accountid: req.params.accountid,
      });

      let result = await this.pUserHdlrImpl.RemoveUserFromAccountLogic(
        removedby,
        contact,
        accountid
      );

      APIResponseOK(req, res, result, "User removed from account successfully");
    } catch (e) {
      this.logger.error("RemoveUserFromAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "REMOVE_USER_FROM_ACCOUNT_ERR",
          e.toString(),
          "Remove user from account failed"
        );
      }
    }
  };

  DeleteUser = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to delete user."
      );
    }
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        deletedby: z
          .string({ message: "Invalid Deleted By User ID format" })
          .uuid({ message: "Deleted By User ID must be a valid UUID" }),
      });

      let { userid, deletedby } = validateAllInputs(schema, {
        userid: req.params.userid,
        deletedby: req.userid,
      });

      let result = await this.pUserHdlrImpl.DeleteUserLogic(userid, deletedby);

      APIResponseOK(req, res, result, "User deleted successfully");
    } catch (e) {
      this.logger.error("DeleteUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "CANNOT_DELETE_SELF" ||
        e.errcode === "USER_NOT_FOUND" ||
        e.errcode === "USER_ALREADY_DELETED" ||
        e.errcode === "CANNOT_DELETE_SEED_USER"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_USER_ERR",
          e.toString(),
          "Delete user failed"
        );
      }
    }
  };

  ResetUserPassword = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to reset user password."
      );
    }
    try {
      let schema = z.object({
        resetby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
        userid: z
          .string({ message: "Invalid Target User ID format" })
          .uuid({ message: "Target User ID must be a valid UUID" }),
      });

      let { resetby, userid } = validateAllInputs(schema, {
        resetby: req.userid,
        userid: req.params.userid,
      });

      let result = await this.pUserHdlrImpl.ResetUserPasswordLogic(
        userid,
        resetby
      );

      APIResponseOK(req, res, result, "User password reset successfully");
    } catch (e) {
      this.logger.error("ResetUserPassword error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "CANNOT_RESET_MAHINDRA_SSO_USER") {
        APIResponseForbidden(
          req,
          res,
          "CANNOT_RESET_MAHINDRA_SSO_USER",
          null,
          e.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "RESET_USER_PASSWORD_ERR",
          null,
          "Reset user password failed"
        );
      }
    }
  };

  GetMyConsolePermissions = async (req, res, next) => {
    try {
      const userid = req.userid;
      const result = await this.pUserHdlrImpl.GetMyConsolePermissionsLogic(
        userid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Console permissions fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetMyConsolePermissions error: ", error);
      if (error.errcode === "CONSOLE_ACCESS_DENIED") {
        APIResponseForbidden(
          req,
          res,
          "CONSOLE_ACCESS_DENIED",
          null,
          error.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_CONSOLE_PERMISSIONS_ERR",
          error.toString(),
          "Get console permissions failed"
        );
      }
    }
  };

  GetMetadataOptions = async (req, res, next) => {
    try {
      let result = await this.pUserHdlrImpl.GetMetadataOptionsLogic();
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle metadata options fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetMetadataOptions error: ", e);
      return APIResponseInternalErr(
        req,
        res,
        "GET_VEHICLE_METADATA_OPTIONS_ERR",
        e.toString(),
        "Get vehicle metadata options failed"
      );
    }
  };

  OnboardUserAccount = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.user.admin",
          "consolemgmt.account.admin",
          "consolemgmt.vehicle.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to onboard user account."
        );
      }
      let baseSchema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        corporatetype: z
          .string({ message: "Corporate type must be a string" })
          .optional()
          .nullable(),
        customeraddress: z
          .string({ message: "Customer address must be a string" })
          .optional()
          .nullable(),
        customeraddresscity: z
          .string({ message: "Customer address city must be a string" })
          .optional()
          .nullable(),
        customeraddresscountry: z
          .string({ message: "Customer address country must be a string" })
          .optional()
          .nullable(),
        customeraddresspincode: z
          .string({ message: "Customer address pincode must be a string" })
          .optional()
          .nullable(),
        customercontactmobile: z
          .string({ message: "Customer contact mobile must be a string" })
          .nonempty({ message: "Customer contact mobile cannot be empty" })
          .min(10, { message: "Mobile number must be 10 digits" })
          .max(10, { message: "Mobile number must be 10 digits" })
          .refine((val) => /^[6-9]\d{9}$/.test(val), {
            message:
              "Invalid mobile number format. Must be 10 digits starting with 6-9.",
          }),
        customerdateofbirth: z
          .string({ message: "Customer date of birth must be a string" })
          .optional()
          .nullable(),
        customergender: z
          .string({ message: "Customer gender must be a string" })
          .refine((val) => ["Male", "Female", "Others", ""].includes(val), {
            message:
              "Invalid gender format. Must be Male, Female, Others or empty.",
          }),
        customername: z
          .string({ message: "Customer name must be a string" })
          .nonempty({ message: "Customer name cannot be empty" }),
        customertype: z
          .string({ message: "Customer type must be a string" })
          .nonempty({ message: "Customer type cannot be empty" }),
        licenseplate: z
          .string({ message: "License plate must be a string" })
          .optional()
          .nullable(),
        vin: z
          .string({ message: "VIN must be a string" })
          .nonempty({ message: "VIN cannot be empty" }),
        nemo_user_mobile: z
          .string({ message: "Nemo user mobile must be a string" })
          .nonempty({ message: "Nemo user mobile cannot be empty" })
          .min(10, { message: "Mobile number must be 10 digits" })
          .max(10, { message: "Mobile number must be 10 digits" })
          .refine((val) => /^[6-9]\d{9}$/.test(val), {
            message:
              "Invalid nemo user mobile format. Must be 10 digits starting with 6-9.",
          }),
        nemo3_account_id: z
          .string({ message: "Account ID must be a string" })
          .uuid({ message: "Account ID must be a valid UUID" })
          .optional()
          .nullable(),
        userrole: z
          .string({ message: "User role must be a string" })
          .optional()
          .nullable(),
      });
      let schema;
      if (req.body.customertype.toLowerCase() === CUSTOMER_TYPE_CORPORATE) {
        schema = baseSchema.extend({
          customercontactemail: z
            .string({ message: "Customer contact email must be a string" })
            .nonempty({ message: "Customer contact email cannot be empty" })
            .email({ message: "Invalid email format" }),
        });
      } else if (
        req.body.customertype.toLowerCase() === CUSTOMER_TYPE_INDIVIDUAL
      ) {
        schema = baseSchema.extend({
          customercontactemail: z
            .string({ message: "Customer contact email must be a string" })
            .optional()
            .nullable(),
        });
      } else {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Invalid customer type"
        );
      }
      const {
        userid,
        corporatetype,
        customeraddress,
        customeraddresscity,
        customeraddresscountry,
        customeraddresspincode,
        customercontactemail,
        customercontactmobile,
        customerdateofbirth,
        customergender,
        customername,
        customertype,
        licenseplate,
        vin,
        nemo_user_mobile,
        nemo3_account_id,
        userrole,
      } = validateAllInputs(schema, {
        userid: req.userid,
        corporatetype: req.body.corporatetype,
        customeraddress: req.body.customeraddress,
        customeraddresscity: req.body.customeraddresscity,
        customeraddresscountry: req.body.customeraddresscountry,
        customeraddresspincode: req.body.customeraddresspincode,
        customercontactemail: req.body.customercontactemail,
        customercontactmobile: req.body.customercontactmobile,
        customerdateofbirth: req.body.customerdateofbirth,
        customergender: req.body.customergender,
        customername: req.body.customername,
        customertype: req.body.customertype,
        licenseplate: req.body.licenseplate,
        vin: req.body.vin,
        nemo_user_mobile: req.body.nemo_user_mobile,
        nemo3_account_id: req.body.nemo3_account_id,
        userrole: req.body.userrole,
      });

      const result = await this.pUserHdlrImpl.OnboardUserAccountLogic(
        userid,
        corporatetype,
        customeraddress,
        customeraddresscity,
        customeraddresscountry,
        customeraddresspincode,
        customercontactemail,
        customercontactmobile,
        customerdateofbirth,
        customergender,
        customername,
        customertype,
        licenseplate,
        vin,
        nemo_user_mobile,
        "onboarding",
        null,
        null,
        nemo3_account_id,
        userrole
      );
      APIResponseOK(req, res, result, result.message);
    } catch (error) {
      this.logger.error("OnboardUserAccount error: ", error);
      if (error.errcode === "CONSOLE_ACCESS_DENIED") {
        APIResponseForbidden(
          req,
          res,
          "ONBOARD_USER_ACCOUNT_ACCESS_DENIED",
          null,
          error.message
        );
      } else if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ONBOARD_USER_ACCOUNT_ERR",
          error.toString(),
          "Onboard user account failed"
        );
      }
    }
  };

  ListPendingUsers = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.user.admin",
          "consolemgmt.user.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list pending users."
        );
      }
      let schema = z.object({
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(1000),
        searchtext: z
          .string({ message: "Search text must be a string" })
          .optional()
          .nullable()
          .refine((val) => !val || val.length === 0 || val.length >= 3, {
            message: "Search text must be at least 3 characters long",
          }),
        orderbyfield: z
          .string({ message: "Order by field must be a string" })
          .optional()
          .nullable(),
        orderbydirection: z
          .string({ message: "Order by direction must be a string" })
          .optional()
          .nullable(),
        download: z
          .boolean({ message: "Download must be a boolean" })
          .optional()
          .default(false),
      });
      const parsedownload = req.query.download === "true";
      let {
        offset,
        limit,
        searchtext,
        orderbyfield,
        orderbydirection,
        download,
      } = validateAllInputs(schema, {
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        searchtext: req.query.searchtext,
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
        download: parsedownload,
      });
      let result = await this.pUserHdlrImpl.ListPendingUsersLogic(
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download
      );
      APIResponseOK(req, res, result, "Pending users listed successfully");
    } catch (e) {
      this.logger.error("ListPendingUsers error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_PENDING_USERS_ERR",
          e.toString(),
          "List pending users failed"
        );
      }
    }
  };

  ListDoneUsers = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.user.admin",
          "consolemgmt.user.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list done users."
        );
      }
      let schema = z.object({
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(1000),
        searchtext: z
          .string({ message: "Search text must be a string" })
          .optional()
          .nullable()
          .refine((val) => !val || val.length === 0 || val.length >= 3, {
            message: "Search text must be at least 3 characters long",
          }),
        orderbyfield: z
          .string({ message: "Order by field must be a string" })
          .optional()
          .nullable(),
        orderbydirection: z
          .string({ message: "Order by direction must be a string" })
          .optional()
          .nullable(),
        download: z
          .boolean({ message: "Download must be a boolean" })
          .optional()
          .default(false),
      });
      const parsedownload = req.query.download === "true";
      let {
        offset,
        limit,
        searchtext,
        orderbyfield,
        orderbydirection,
        download,
      } = validateAllInputs(schema, {
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        searchtext: req.query.searchtext,
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
        download: parsedownload,
      });
      let result = await this.pUserHdlrImpl.ListDoneUsersLogic(
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download
      );
      APIResponseOK(req, res, result, "Done users listed successfully");
    } catch (e) {
      this.logger.error("ListDoneUsers error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_DONE_USERS_ERR",
          e.toString(),
          "List done users failed"
        );
      }
    }
  };

  // Composite Onboard API
  CompositeOnboardAPI = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.user.admin",
          "consolemgmt.account.admin",
          "consolemgmt.vehicle.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to onboard user."
        );
      }

      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        taskid: z
          .string({ message: "Invalid Task ID format" })
          .uuid({ message: "Invalid Task ID format" }),
        tasktype: z
          .string({ message: "Task type must be a string" })
          .nonempty({ message: "Task type cannot be empty" }),
        updatedfields: z
          .union([
            // Schema for accountreview
            z.object({
              accountname: z
                .string({ message: "Account name must be a string" })
                .nonempty({ message: "Account name cannot be empty" }),
            }),
            // Schema for userreview
            z.object({
              displayname: z.string().optional(),
              mobile: z.string().optional(),
              email: z.string().optional(),
              address: z.string().optional(),
              city: z.string().optional(),
              country: z.string().optional(),
              pincode: z.string().optional(),
              dateofbirth: z.string().optional(),
              gender: z.string().optional(),
              vehiclemobile: z.string().optional(),
              nemo3_account_id: z.string().optional(),
            }),
          ])
          .refine(
            (val) => {
              // Ensure at least one field is provided
              return Object.keys(val).length > 0;
            },
            {
              message: "At least one field must be provided in updatedfields",
            }
          ),
      });

      const { userid, taskid, tasktype, updatedfields } = validateAllInputs(
        schema,
        {
          userid: req.userid,
          taskid: req.body.taskid,
          tasktype: req.body.tasktype,
          updatedfields: req.body.updatedfields,
        }
      );

      const result = await this.pUserHdlrImpl.CompositeOnboardAPILogic({
        userid,
        taskid,
        tasktype,
        updatedfields,
      });

      APIResponseOK(req, res, result, result.message);
    } catch (error) {
      this.logger.error("CompositeOnboardAPI error: ", error);
      if (error.errcode === "CONSOLE_ACCESS_DENIED") {
        APIResponseForbidden(
          req,
          res,
          "ONBOARD_USER_ACCOUNT_ACCESS_DENIED",
          null,
          error.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ONBOARD_USER_ACCOUNT_ERR",
          error.toString(),
          "Onboard user account failed"
        );
      }
    }
  };

  RetryOnboard = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.user.admin",
          "consolemgmt.account.admin",
          "consolemgmt.vehicle.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to retry onboard."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        retrytype: z
          .string({ message: "Invalid Retry Type format" })
          .nonempty({ message: "Retry Type cannot be empty" })
          .refine((val) => ["user", "account"].includes(val), {
            message: "Invalid Retry Type format",
          }),
      });
      let { userid, retrytype } = validateAllInputs(schema, {
        userid: req.userid,
        retrytype: req.body.retrytype,
      });

      let result = await this.pUserHdlrImpl.RetryOnboardLogic(
        userid,
        retrytype
      );
      APIResponseOK(req, res, result, "Retry onboard successfully");
    } catch (e) {
      this.logger.error("RetryOnboard error: ", e);
      if (e.errcode === "CONSOLE_ACCESS_DENIED") {
        APIResponseForbidden(
          req,
          res,
          "RETRY_ONBOARD_ACCESS_DENIED",
          null,
          e.message
        );
      } else if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "RETRY_ONBOARD_ERR",
          e.toString(),
          "Retry onboard failed"
        );
      }
    }
  };

  GetUserAccountList = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.user.admin",
          "consolemgmt.user.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get user account list."
        );
      }
      const schema = z.discriminatedUnion("usertype", [
        z.object({
          usertype: z.literal("email"),
          contact: z
            .string({ message: "Contact must be a string" })
            .trim()
            .email({ message: "Invalid email format" }),
        }),
        z.object({
          usertype: z.literal("mobile"),
          contact: z
            .string({ message: "Mobile must be a string" })
            .trim()
            .min(10, { message: "Mobile number must be 10 digits" })
            .max(10, { message: "Mobile number must be 10 digits" })
            .refine((val) => /^[6-9]\d{9}$/.test(val), {
              message:
                "Invalid mobile number format. Must be 10 digits starting with 6-9.",
            }),
        }),
      ]);
      const { contact, usertype } = validateAllInputs(schema, {
        contact: req.body.contact,
        usertype: req.body.usertype,
      });
      let result = await this.pUserHdlrImpl.GetUserAccountListLogic(
        contact,
        usertype
      );
      APIResponseOK(req, res, result, "User account list listed successfully");
    } catch (e) {
      this.logger.error("GetUserAccountList error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_USER_ACCOUNT_LIST_ERR",
          e.toString(),
          "Get user account list failed"
        );
      }
    }
  };

  CreateAdminUser = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create user."
      );
    }
    try {
      let schema = z.object({
        createdby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        email: z
          .string({ message: "Invalid Email format" })
          .email({ message: "Invalid email format" }),
        mobile: z
          .string({ message: "Invalid Mobile Number format" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          }),
        displayname: z
          .string({ message: "Invalid Display Name format" })
          .nonempty({ message: "Display Name cannot be empty" })
          .max(128, {
            message: "Display Name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Display Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { createdby, displayname, email, mobile, accountid } =
        validateAllInputs(schema, {
          createdby: req.userid,
          displayname: req.body.displayname,
          email: req.body.email,
          mobile: req.body.mobile,
          accountid: req.body.accountid,
        });

      let result = await this.pUserHdlrImpl.CreateFmsUserLogic(
        displayname,
        email,
        mobile,
        createdby,
        accountid,
        "admin"
      );

      APIResponseOK(req, res, result, "User created successfully");
    } catch (e) {
      this.logger.error("CreateUser error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_USER_ERR",
          e.toString(),
          "Create user failed"
        );
      }
    }
  };

  UserDetailsByErrorCode = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.user.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get user details by error code."
      );
    }
    try {
      let schema = z.object({
        mobile: z
          .string({ message: "Invalid Mobile Number format" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          })
          .optional()
          .nullable(),
        email: z
          .string({ message: "Invalid Email format" })
          .email({ message: "Invalid email format" })
          .optional()
          .nullable(),
      });

      let { mobile, email } = validateAllInputs(schema, {
        mobile: req.body.mobile,
        email: req.body.email,
      });

      let result = await this.pUserHdlrImpl.UserDetailsByErrorCodeLogic(
        mobile,
        email
      );

      APIResponseOK(
        req,
        res,
        result,
        "User details by error code listed successfully"
      );
    } catch (e) {
      this.logger.error("UserDetailsByErrorCode error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "USER_NOT_FOUND") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_USER_DETAILS_BY_ERROR_CODE_ERR",
          e.toString(),
          "List user details by error code failed"
        );
      }
    }
  };
}
