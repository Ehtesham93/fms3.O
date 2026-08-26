import crypto from "crypto";
import { UAParser } from "ua-parser-js";
import z from "zod";

import {
  ADMIN_ROLE_ID,
  INVITE_RATE_LIMIT_PER_HOUR,
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
import AccountHdlrImpl from "./accounthdlr_impl.js";
import { parseQueryInt } from "../../../utils/commonutil.js";

export default class AccountHdlr {
  constructor(
    accountSvcI,
    userSvcI,
    authSvcI,
    fmsAccountSvcI,
    platformSvcI,
    inMemCacheI,
    redisSvc,
    logger
  ) {
    this.accountSvcI = accountSvcI;
    this.userSvcI = userSvcI;
    this.authSvcI = authSvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.platformSvcI = platformSvcI;
    this.inMemCacheI = inMemCacheI;
    this.redisSvc = redisSvc;
    this.logger = logger;
    this.accountHdlrImpl = new AccountHdlrImpl(
      accountSvcI,
      userSvcI,
      authSvcI,
      fmsAccountSvcI,
      platformSvcI,
      redisSvc,
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

  getRootFleetInviteFingerprint = (req, accountid, contact) => {
    const deviceFingerprint = this.getDeviceFingerprint(req);
    const inviteSpecificData = `${deviceFingerprint}-${accountid}-Home-${contact}`;
    const inviteFingerprint = crypto
      .createHash("sha256")
      .update(inviteSpecificData)
      .digest("hex");

    return inviteFingerprint;
  };

  RegisterRoutes(router) {
    router.post("/", this.CreateAccount);
    router.get("/list", this.ListAccounts);
    router.get("/availablefortagging", this.AccountsAvailableForTagging);
    router.get("/:accountid/overview", this.GetAccountOverview);
    router.put("/:accountid", this.UpdateAccount);
    router.delete("/:accountid", this.DeleteAccount);

    // account - users
    router.get("/:accountid/users", this.GetAccountUsers);
    router.post("/:accountid/user", this.AddUserToAccount);
    router.get("/:accountid/invites", this.ListAccountInvites);
    router.post("/:accountid/invite/cancel", this.CancelEmailInvite);
    router.post("/:accountid/invite", this.InviteContact);
    router.post("/:accountid/invite/resend", this.ResendInvite);
    router.delete("/:accountid/user/:userid", this.RemoveUserFromAccount);
    router.get("/:accountid/pkgs", this.GetAccountPkgs);
    router.post("/:accountid/pkg", this.AddCustomPkgToAccount);
    router.get("/:accountid/pkgs/unassigned", this.GetUnassignedCustomPkgs);
    router.delete("/:accountid/pkg/:pkgid", this.RemoveCustomPkgFromAccount);

    // subscriptions
    router.get(
      "/:accountid/subscription/pkgs",
      this.ListPackagesForSubscription
    );
    router.post(
      "/:accountid/subscription/cost",
      this.CalculateSubscriptionCost
    );
    router.post("/:accountid/subscription", this.CreateSubscription);
    router.get("/:accountid/subscription", this.GetSubscriptionInfo);

    router.get("/:accountid/credits", this.GetAccountCredits);
    router.put("/:accountid/credits", this.UpdateAccountCredits); // TODO: change this to post?
    router.get("/:accountid/credits/overview", this.GetAccountCreditsOverview);
    router.get("/:accountid/credits/history", this.GetAccountCreditsHistory);
    router.get(
      "/:accountid/vehicle/:vinno/credits/history",
      this.GetAccountVehicleCreditsHistory
    );
    // router.get(
    //   "/:accountid/fleets/credits/history",
    //   this.GetAccountAllFleetsCreditsHistory
    // );
    router.get("/:accountid/vehicles", this.ListAccountVehicles);
    router.post("/:accountid/vehicles/subscribe", this.SubscribeVehicles);
    router.post("/:accountid/vehicle/unsubscribe", this.UnsubscribeVehicle);
    router.post(
      "/:accountid/subscription/checkchangepkg",
      this.CheckChangeSubscriptionPackage
    );
    router.post(
      "/:accountid/subscription/changepkg",
      this.ChangeSubscriptionPackage
    );
    router.get("/:accountid/subscription/history", this.GetSubscriptionHistory);

    router.get(
      "/:accountid/getallfleetswithvininfo",
      this.GetAllFleetsWithVinInfo
    );

    router.get("/:accountid/vehicles/assignable", this.ListAssignableVehicles);
    router.post("/:accountid/vehicle/:vinno", this.AddVehicleToAccount);
    router.delete("/:accountid/vehicle/:vinno", this.RemoveVehicleFromAccount);

    router.get("/listpending", this.ListPendingAccounts);
    router.get("/listdone", this.ListDoneAccounts);
    router.get("/summary", this.GetAccountSummary);
    router.post("/isaccountnameavailable", this.IsAccountNameAvailable);
    router.get("/listallaccounts", this.ListAllAccounts);
    router.post("/createcorporateaccount", this.CreateCorporateAccount);
    router.get("/users", this.GetAllAccountUsers);
    router.get("/users/loggedin", this.GetAllLoggedInAccountUsers);
    router.get("/accountcategory", this.GetAccountCategory);
  }

  CreateAccount = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, ["consolemgmt.account.admin"], "all")
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create account."
        );
      }

      const schema = z.object({
        accountname: z
          .string({ message: "Invalid Account Name format" })
          .nonempty({ message: "Account Name cannot be empty" })
          .max(128, {
            message: "Account Name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _\-&]*[A-Za-z0-9])?$/, {
            message:
              "Account name can only contain letters, numbers, spaces, hyphens, underscores, and ampersand",
          }),
        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
        mobile: z
          .string({ message: "Mobile must be a string" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          })
          .optional(),
        accountinfo: z
          .record(z.any(), { message: "Account Info must be an object" })
          .optional()
          .default({}),
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Invalid Account ID format" })
          .optional(),
        accountcategory: z
          .enum(["individual", "corporate", "aggregator", "financier"], {
            errorMap: () => ({ message: "Invalid Account Category" }),
          })
          .default("individual"),
        
      });

      let createdby = req.userid;
      const { accountname, isenabled, mobile, accountinfo, accountid, accountcategory } =
        validateAllInputs(schema, {
          accountname: req.body.accountname,
          isenabled: req.body.isenabled,
          mobile: req.body.mobile,
          accountinfo: req.body.accountinfo,
          accountid: req.body.accountid,
          accountcategory: req.body.accountcategory,
        });

      let result = await this.accountHdlrImpl.CreateAccountLogic(
        accountname,
        accountinfo,
        isenabled,
        createdby,
        mobile,
        accountid,
        accountcategory
      );
      APIResponseOK(req, res, result, "Account created successfully");
    } catch (error) {
      this.logger.error("CreateAccount error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (error.errcode === "ACCOUNT_ALREADY_EXISTS") {
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
          "CREATE_ACCOUNT_ERR",
          error.toString(),
          "Create account failed"
        );
      }
    }
  };

  ListAccounts = async (req, res, next) => {
    try {
      // if (
      //   !CheckUserPerms(req.userperms, [
      //     "consolemgmt.account.view",
      //     "consolemgmt.account.admin",
      //   ])
      // ) {
      //   return APIResponseForbidden(
      //     req,
      //     res,
      //     "INSUFFICIENT_PERMISSIONS",
      //     null,
      //     "You don't have permission to list accounts."
      //   );
      // }
      let schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine(
            (val) => !val || val.length === 0 || val.length >= 3,
            { message: "Search text must be at least 3 characters long" }
          ),
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(1000),
      });
      let { searchtext, offset, limit } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
      });
      let result = await this.accountHdlrImpl.ListAccountsLogic(searchtext, offset, limit);
      APIResponseOK(req, res, result, "Accounts fetched successfully");
    } catch (e) {
      this.logger.error("ListAccounts error: ", e);
      if(e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          e.errcode,
          e.errdata,
          e.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_ACCOUNTS_ERR",
          e.toString(),
          "List accounts failed"
        );
      }
    }
  };

  GetAccountOverview = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Invalid Account ID format" }),
      });
      const { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });
      let result = await this.accountHdlrImpl.GetAccountOverviewLogic(
        accountid
      );
      APIResponseOK(req, res, result, "Account overview fetched successfully");
    } catch (error) {
      this.logger.error("GetAccountOverview error: ", error);
      if (error.errcode === "INPUT_ERROR") {
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
          "GET_ACCOUNT_OVERVIEW_ERR",
          error.toString(),
          "Get account overview failed"
        );
      }
    }
  };

  GetAccountSummary = async (req, res, next) => {
    try {
      const schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine(
            (val) => !val || val.length === 0 || val.length >= 3,
            { message: "Search text must be at least 3 characters long" }
          ),
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
          .string({ message: "Order by is required" })
          .optional()
          .nullable(),
        orderbydirection: z
          .string({ message: "Order by direction is required" })
          .optional()
          .nullable(),
      });
      const parseDownload = req.query.download === "true";
      const { searchtext, offset, limit, download, orderbyfield, orderbydirection } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        download: parseDownload,
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
      });
      let result = await this.accountHdlrImpl.GetAccountSummaryLogic(searchtext, offset, limit, download, orderbyfield, orderbydirection);
      APIResponseOK(req, res, result, "Account summary fetched successfully");
    } catch (error) {
      this.logger.error("GetAccountSummary error: ", error);
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
          "GET_ACCOUNT_SUMMARY_ERR",
          error.toString(),
          "Get account summary failed"
        );
      }
    }
  };

  GetAllAccountUsers = async (req, res, next) => {
    try {
      const schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine(
            (val) => !val || val.length === 0 || val.length >= 3,
            { message: "Search text must be at least 3 characters long" }
          ),
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
      });
      const parseDownload = req.query.download === "true";
      const { searchtext, offset, limit, download } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        download: parseDownload,
      });
      let result = await this.accountHdlrImpl.GetAllAccountUsersLogic(searchtext, offset, limit, download);
      APIResponseOK(req, res, result, "All account users fetched successfully");
    } catch (error) {
      this.logger.error("GetAllAccountUsers error: ", error);
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
          "GET_ALL_ACCOUNT_USERS_ERR",
          error.toString(),
          "Get all account users failed"
        );
      }
    }
  };

  GetAllLoggedInAccountUsers = async (req, res, next) => {
    try {
      const schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine(
            (val) => !val || val.length === 0 || val.length >= 3,
            { message: "Search text must be at least 3 characters long" }
          ),
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
          .string({ message: "Order by is required" })
          .optional()
          .nullable(),
        orderbydirection: z
          .string({ message: "Order by direction is required" })
          .optional()
          .nullable(),
      });
      const parseDownload = req.query.download === "true";
      const { searchtext, offset, limit, download, orderbyfield, orderbydirection } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        download: parseDownload,
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
      });
      let result = await this.accountHdlrImpl.GetAllLoggedInAccountUsersLogic(searchtext, offset, limit, download, orderbyfield, orderbydirection);
      APIResponseOK(req, res, result, "All logged in account users fetched successfully");
    } catch (error) {
      this.logger.error("GetAllLoggedInAccountUsers error: ", error);
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
          "GET_ALL_LOGGED_IN_ACCOUNT_USERS_ERR",
          error.toString(),
          "Get all logged in account users failed"
        );
      }
    }
  };

  UpdateAccount = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.account.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update account."
        );
      }
      let schema = z
        .object({
          accountid: z
            .string({ message: "Account ID is required" })
            .uuid({ message: "Invalid Account ID" }),

          updatedby: z
            .string({ message: "User ID is required" })
            .uuid({ message: "Invalid User ID" }),

          accountname: z
            .string({ message: "Invalid Account Name format" })
            .max(128, {
              message: "Account Name must be at most 128 characters long",
            })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Account name can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .optional(),

          isenabled: z
            .boolean({ message: "isenabled must be true or false" })
            .optional(),

          accountinfo: z
            .record(z.any(), { message: "Account Info must be an object" })
            .optional(),

          mobile: z
            .string({ message: "Mobile must be a string" })
            .regex(/^[6-9]\d{9}$/, {
              message:
                "Mobile number must be exactly 10 digits and start with 6 to 9",
            })
            .optional(),
          accountcategory: z
            .enum(["individual", "corporate", "aggregator", "financier"], {
              errorMap: () => ({ message: "Invalid Account Category" }),
            })
            .optional(),
        })
        .refine(
          (data) => {
            const updateKeys = Object.keys(data).filter(
              (key) => key !== "accountid" && key !== "updatedby"
            );
            return updateKeys.length > 0;
          },
          { message: "No fields provided for update" }
        );

      let input = {
        accountid: req.params.accountid,
        updatedby: req.userid,
        ...req.body,
      };

      let { accountid, updatedby, ...updateFields } = validateAllInputs(
        schema,
        input
      );
      let result = await this.accountHdlrImpl.UpdateAccountLogic(
        accountid,
        updateFields,
        updatedby
      );

      APIResponseOK(req, res, result, "Account updated successfully");
    } catch (e) {
      this.logger.error("UpdateAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_ACCOUNT_ERR",
          e.toString(),
          "Update account failed"
        );
      }
    }
  };

  DeleteAccount = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.account.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete account."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        deletedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      let { accountid, deletedby } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        deletedby: req.userid,
      });
      let result = await this.accountHdlrImpl.DeleteAccountLogic(
        accountid,
        deletedby
      );
      APIResponseOK(req, res, result, "Account deleted successfully");
    } catch (e) {
      this.logger.error("DeleteAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "ACCOUNT_NOT_FOUND") {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else if (e.errcode === "ACCOUNT_ALREADY_DELETED") {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else if (e.errcode === "ACCOUNT_HAS_VEHICLES") {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "DELETE_ACCOUNT_ERR",
          e.toString(),
          "Delete account failed"
        );
      }
    }
  };

  AddUserToAccount = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountuser.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to add user to account."
        );
      }
      const schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        updatedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),

        contact: z
          .string({ message: "Contact is required" })
          .email({ message: "Contact must be a valid email address" }),
      });

      const { accountid, updatedby, contact } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        updatedby: req.userid,
        contact: req.body.email,
      });

      const result = await this.accountHdlrImpl.AddAdminToAccRootFleetLogic(
        accountid,
        contact,
        updatedby
      );

      APIResponseOK(req, res, result, "User added to account successfully");
    } catch (e) {
      this.logger.error("AddUserToAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "ACCOUNT_NOT_FOUND") {
        return APIResponseBadRequest(req, res, e.errcode, {}, e.message);
      } else if (e.errcode === "ACCOUNT_ALREADY_DELETED") {
        return APIResponseBadRequest(req, res, e.errcode, {}, e.message);
      } else if (e.errcode === "USER_ALREADY_IN_ACCOUNT") {
        return APIResponseBadRequest(req, res, e.errcode, {}, e.message);
      } else if (e.message === "User not found") {
        return APIResponseBadRequest(
          req,
          res,
          "USER_NOT_FOUND",
          {},
          "No user found with the provided contact information"
        );
      } else if (e.message === "Account root fleet not found") {
        return APIResponseBadRequest(
          req,
          res,
          "ACCOUNT_CONFIGURATION_ERROR",
          {},
          "Account configuration is invalid. Please contact support."
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "ADD_USER_TO_ACCOUNT_ERR",
          e.toString(),
          "Add user to account failed"
        );
      }
    }
  };

  GetAccountUsers = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.view",
          "consolemgmt.account.admin",
          "consolemgmt.accountuser.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account users."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });
      let { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });
      let result = await this.accountHdlrImpl.GetAccountUsersLogic(accountid);
      APIResponseOK(req, res, result, "Account users fetched successfully");
    } catch (e) {
      this.logger.error("GetAccountUsers error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_USERS_ERR",
          e.toString(),
          "Get account users failed"
        );
      }
    }
  };

  ListAccountInvites = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.view",
          "consolemgmt.account.admin",
          "consolemgmt.accountuser.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list account invites."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });

      let result = await this.accountHdlrImpl.ListInvitesOfAccountLogic(
        accountid
      );

      APIResponseOK(req, res, result, "Account invites fetched successfully");
    } catch (e) {
      this.logger.error("ListAccountInvites error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_INVITES_OF_ACCOUNT_ERR",
          e.toString(),
          "List invites of account failed"
        );
      }
    }
  };

  CancelEmailInvite = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountuser.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to cancel email invite."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        cancelledby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID Invalid format" }),

        inviteid: z
          .string({ message: "Invite ID is required" })
          .uuid({ message: "Invalid Invite ID format" }),
      });

      let { accountid, inviteid, cancelledby } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        cancelledby: req.userid,
        inviteid: req.body.inviteid,
      });
      let result = await this.accountHdlrImpl.CancelEmailInviteLogic(
        accountid,
        inviteid,
        cancelledby
      );

      APIResponseOK(req, res, result, "Email invite cancelled successfully");
    } catch (e) {
      this.logger.error("CancelEmailInvite error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CANCEL_EMAIL_INVITE_ERR",
          e.toString(),
          "Cancel email invite failed"
        );
      }
    }
  };

  RemoveUserFromAccount = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountuser.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to remove user from account."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        updatedby: z
          .string({ message: "UpdatedBy is required" })
          .uuid({ message: "UpdatedBy must be a valid UUID" }),
      });

      let { accountid, userid, updatedby } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        userid: req.params.userid,
        updatedby: req.userid,
      });

      let result = await this.accountHdlrImpl.RemoveUserFromAccountLogic(
        accountid,
        userid,
        updatedby
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

  GetAccountPkgs = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.accountpkg.admin",
          "consolemgmt.account.view",
          "consolemgmt.account.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account packages."
        );
      }
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });
      const { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });
      let result = await this.accountHdlrImpl.GetAccountPkgsLogic(accountid);
      APIResponseOK(req, res, result, "Account packages fetched successfully");
    } catch (e) {
      this.logger.error("GetAccountPkgs error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_PKGS_ERR",
          e.toString(),
          "Get account packages failed"
        );
      }
    }
  };

  GetUnassignedCustomPkgs = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.accountpkg.admin",
          "consolemgmt.account.view",
          "consolemgmt.account.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get unassigned custom packages."
        );
      }
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });
      let { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });
      let result = await this.accountHdlrImpl.GetUnassignedCustomPkgsLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Unassigned custom packages fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetUnassignedCustomPkgs error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_UNASSIGNED_CUSTOM_PKGS_ERR",
          e.toString(),
          "Get unassigned custom packages failed"
        );
      }
    }
  };

  AddCustomPkgToAccount = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountpkg.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to add custom package to account."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        updatedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),
        pkgids: z
          .array(
            z
              .string({ message: "Invalid Package ID format" })
              .uuid({ message: "Invalid Package ID format" })
              .nonempty({ message: "Invalid package IDs" })
          )
          .min(1, { message: "At least one Package ID is required" }),
      });

      let { accountid, updatedby, pkgids } = validateAllInputs(schema, {
        updatedby: req.userid,
        accountid: req.params.accountid,
        pkgids: req.body.pkgids,
      });

      if (!pkgids || !Array.isArray(pkgids) || pkgids.length === 0) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_PKGIDS",
          "Invalid package IDs"
        );
        return;
      }
      let result = await this.accountHdlrImpl.AddCustomPkgToAccountLogic(
        accountid,
        pkgids,
        updatedby
      );
      APIResponseOK(
        req,
        res,
        result,
        "Custom package added to account successfully"
      );
    } catch (e) {
      this.logger.error("AddCustomPkgToAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ADD_CUSTOM_PKG_TO_ACCOUNT_ERR",
          e.toString(),
          "Add custom package to account failed"
        );
      }
    }
  };

  RemoveCustomPkgFromAccount = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountpkg.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to remove custom package from account."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Invalid Account ID format" }),

        updatedby: z
          .string({ message: "UpdatedBy is required" })
          .uuid({ message: "User ID must be a valid UUID" }),

        pkgid: z
          .string({ message: "Package ID is required" })
          .uuid({ message: "Invalid Package ID format" }),
      });

      let { accountid, updatedby, pkgid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        updatedby: req.userid,
        pkgid: req.params.pkgid,
      });

      let result = await this.accountHdlrImpl.RemoveCustomPkgFromAccountLogic(
        accountid,
        pkgid,
        updatedby
      );

      APIResponseOK(
        req,
        res,
        result,
        "Custom package removed from account successfully"
      );
    } catch (e) {
      this.logger.error("RemoveCustomPkgFromAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "REMOVE_CUSTOM_PKG_FROM_ACCOUNT_ERR",
          e.toString(),
          "Remove custom package from account failed"
        );
      }
    }
  };

  InviteContact = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountuser.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to invite contact to account."
        );
      }
      let invitedby = req.userid;
      let accountid = req.params.accountid;
      let contact = req.body.contact;
      let roles = [ADMIN_ROLE_ID];
      let headerReferer = req.headers.origin;

      let contactSchema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        invitedby: z
          .string({ message: "InvitedBy is required" })
          .uuid({ message: "InvitedBy ID is required" }),

        contact: z
          .string({ message: "Contact is required" })
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

      let { contact: validatedContact } = validateAllInputs(contactSchema, {
        accountid,
        invitedby,
        contact,
      });

      const inviteFingerprint = this.getRootFleetInviteFingerprint(
        req,
        accountid,
        validatedContact
      );
      const rateLimitKey = `root_fleet_invite_rate_limit:${inviteFingerprint}`;

      let currentCount = this.inMemCacheI.get(rateLimitKey) || 0;

      if (currentCount >= INVITE_RATE_LIMIT_PER_HOUR) {
        const error = new Error(
          "Too many invites sent to this contact for this account. Please try after an hour."
        );
        error.errcode = "RATE_LIMIT_EXCEEDED";
        throw error;
      }

      let isEmail = validatedContact.includes("@");
      let isMahindrasso = validatedContact.includes("@mahindra.com");
      let result = null;

      if (isMahindrasso) {
        result = await this.accountHdlrImpl.MahindrassoInviteToRootFleetLogic(
          accountid,
          validatedContact,
          invitedby,
          roles,
          headerReferer
        );
      }else if (isEmail) {
        result = await this.accountHdlrImpl.EmailInviteToRootFleetLogic(
          accountid,
          validatedContact,
          invitedby,
          roles,
          headerReferer
        );
      }else {
        result = await this.accountHdlrImpl.MobileInviteToRootFleetLogic(
          accountid,
          validatedContact,
          invitedby,
          roles,
          headerReferer
        );
      }

      this.inMemCacheI.set(rateLimitKey, currentCount + 1);

      return APIResponseOK(req, res, result, "Invite sent successfully");
    } catch (e) {
      this.logger.error("InviteContact error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "RATE_LIMIT_EXCEEDED") {
        APIResponseError(
          req,
          res,
          429,
          "RATE_LIMIT_EXCEEDED",
          null,
          "Too many resend attempts for this invite. Please try after an hour."
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_INVITE_ERR",
          e.toString(),
          "Create invite failed"
        );
      }
    }
  };

  ResendInvite = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountuser.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to resend invite."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        invitedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),

        inviteid: z
          .string({ message: "Invite ID is required" })
          .uuid({ message: "Invalid Invite ID format" }),
      });

      let { accountid, invitedby, inviteid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        invitedby: req.userid,
        inviteid: req.body.inviteid,
      });

      const deviceFingerprint = this.getDeviceFingerprint(req);
      const resendFingerprint = crypto
        .createHash("sha256")
        .update(`${deviceFingerprint}-${inviteid}`)
        .digest("hex");
      const rateLimitKey = `root_fleet_resend_rate_limit:${resendFingerprint}`;

      let currentCount = this.inMemCacheI.get(rateLimitKey) || 0;

      if (currentCount >= INVITE_RATE_LIMIT_PER_HOUR) {
        const error = new Error(
          "Too many resend attempts for this invite. Please try after an hour."
        );
        error.errcode = "RATE_LIMIT_EXCEEDED";
        throw error;
      }

      let headerReferer = req.headers.origin;

      let result = await this.accountHdlrImpl.ResendInviteLogic(
        accountid,
        inviteid,
        invitedby,
        headerReferer
      );
      this.inMemCacheI.set(rateLimitKey, currentCount + 1);
      APIResponseOK(req, res, result, "Invite resent successfully");
    } catch (e) {
      this.logger.error("ResendInvite error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "RATE_LIMIT_EXCEEDED") {
        APIResponseError(
          req,
          res,
          429,
          "RATE_LIMIT_EXCEEDED",
          null,
          "Too many resend attempts for this invite. Please try after an hour."
        );
      } else if (
        e.errcode === "INVALID_INVITE_ID" ||
        e.errcode === "INVITE_NOT_IN_SENT_STATE" ||
        e.errcode === "INVITE_NOT_AN_EMAIL_INVITE" ||
        e.errcode === "CANNOT_RESEND_AN_EXPIRED_INVITE" ||
        e.errcode === "ACCOUNT_NOT_FOUND" ||
        e.errcode === "FLEET_NOT_FOUND"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "RESEND_INVITE_ERR",
          e.errdata,
          "Resend invite failed"
        );
      }
    }
  };

  ListPackagesForSubscription = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      const { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });
      let result = await this.accountHdlrImpl.ListPackagesForSubscriptionLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Packages for subscription fetched successfully"
      );
    } catch (e) {
      this.logger.error("ListPackagesForSubscription error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_PACKAGES_FOR_SUBSCRIPTION_ERR",
          e.toString(),
          "List packages for subscription failed"
        );
      }
    }
  };

  CalculateSubscriptionCost = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.accountpkg.admin",
          "consolemgmt.account.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to calculate subscription cost."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        pkgid: z
          .string({ message: "Package ID is required" })
          .uuid({ message: "Invalid Package ID format" }),

        vehdays: z
          .number({ message: "Vehicle days is required" })
          .min(1, { message: "Vehicle days must be at least 1" }),

        discountpercent: z
          .number({ message: "Invalid Discount Percent format" })
          .default(0),

        startdatems: z.number({ message: "Start date (ms) is required" }),

        enddatems: z.number({ message: "End date (ms) is required" }),
      });
      let {
        accountid,
        pkgid,
        vehdays,
        discountpercent,
        startdatems,
        enddatems,
      } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        pkgid: req.body.pkgid,
        vehdays: req.body.vehdays,
        discountpercent: req.body.discountpercent,
        startdatems: req.body.startdatems,
        enddatems: req.body.enddatems,
      });

      let result = await this.accountHdlrImpl.CalculateSubscriptionCostLogic(
        accountid,
        pkgid,
        vehdays,
        discountpercent,
        startdatems,
        enddatems
      );

      APIResponseOK(
        req,
        res,
        result,
        "Subscription cost calculated successfully"
      );
    } catch (e) {
      this.logger.error("CalculateSubscriptionCost error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CALCULATE_SUBSCRIPTION_COST_ERR",
          e.toString(),
          "Calculate subscription cost failed"
        );
      }
    }
  };

  CreateSubscription = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.accountpkg.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create subscription."
      );
    }
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Invalid Account ID format" }),
        createdby: z
          .string({ message: "Createdby ID is required" })
          .uuid({ message: "Createdby ID is required" }),
        pkgid: z
          .string({ message: "Package ID is required" })
          .uuid({ message: "Invalid Package ID format" }),
      });

      let { accountid, createdby, pkgid } = validateAllInputs(schema, {
        createdby: req.userid,
        accountid: req.params.accountid,
        pkgid: req.body.pkgid,
      });
      let result = await this.accountHdlrImpl.CreateSubscriptionLogic(
        accountid,
        pkgid,
        createdby
      );
      APIResponseOK(req, res, result, "Subscription created successfully");
    } catch (e) {
      this.logger.error("CreateSubscription error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_SUBSCRIPTION_ERR",
          e.toString(),
          "Create subscription failed"
        );
      }
    }
  };

  GetSubscriptionInfo = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.view",
          "consolemgmt.account.admin",
          "consolemgmt.accountpkg.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get subscription info."
        );
      }
      const schema = z.object({
        userid: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Invalid Account ID format" }),
      });

      const { userid, accountid } = validateAllInputs(schema, {
        userid: req.userid,
        accountid: req.params.accountid,
      });

      let result = await this.accountHdlrImpl.GetSubscriptionInfoLogic(
        accountid,
        userid
      );
      APIResponseOK(req, res, result, "Subscription info fetched successfully");
    } catch (e) {
      this.logger.error("GetSubscriptionInfo error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "GET_SUBSCRIPTION_INFO_ERR",
          e.toString(),
          "Get subscription info failed"
        );
      }
    }
  };

  GetAccountCredits = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.credits.admin",
          "consolemgmt.credits.view",
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
        accountid: req.params.accountid,
      });

      let result = await this.accountHdlrImpl.GetAccountCreditsLogic(accountid);
      APIResponseOK(req, res, result, "Account credits fetched successfully");
    } catch (e) {
      this.logger.error("GetAccountCredits error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_CREDITS_ERR",
          e.toString(),
          "Get account credits failed"
        );
      }
    }
  };

  UpdateAccountCredits = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.credits.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update account credits."
        );
      }
      let schema = z.object({
        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        credits: z.number({ message: "Invalid Credit format" }),
      });
      let { updatedby, accountid, credits } = validateAllInputs(schema, {
        updatedby: req.userid,
        accountid: req.params.accountid,
        credits: req.body.credits,
      });

      let result = await this.accountHdlrImpl.UpdateAccountCreditsLogic(
        accountid,
        credits,
        updatedby
      );

      APIResponseOK(req, res, result, "Account credits updated successfully");
    } catch (e) {
      this.logger.error("UpdateAccountCredits error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_ACCOUNT_CREDITS_ERR",
          e.toString(),
          "Update account credits failed"
        );
      }
    }
  };

  GetAccountCreditsOverview = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.credits.admin",
          "consolemgmt.credits.view",
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
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z
          .number({ message: "Start Time must be a number" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, {
            message: "Start Time is invalid",
          }),
        endtime: z
          .number({ message: "End Time must be a number" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, {
            message: "End Time is invalid",
          }),
      });
      let { accountid, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        starttime: Number(req.query.starttime || 0),
        endtime: Number(req.query.endtime || 0),
      });

      let result = await this.accountHdlrImpl.GetAccountCreditsOverviewLogic(
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
    } catch (e) {
      this.logger.error("GetAccountCreditsOverview error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_CREDITS_OVERVIEW_ERR",
          e.toString(),
          "Get account credits overview failed"
        );
      }
    }
  };

  GetAccountCreditsHistory = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.credits.admin",
          "consolemgmt.credits.view",
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
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z
          .number({ message: "Start Time must be a number" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, {
            message: "Start Time is invalid",
          }),
        endtime: z
          .number({ message: "End Time must be a number" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, {
            message: "End Time is invalid",
          }),
      });
      let { accountid, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        starttime: Number(req.query.starttime || 0),
        endtime: Number(req.query.endtime || 0),
      });

      let result = await this.accountHdlrImpl.GetAccountCreditsHistoryLogic(
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
    } catch (e) {
      this.logger.error("GetAccountCreditsHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_CREDITS_HISTORY_ERR",
          e.toString(),
          "Get account credits history failed"
        );
      }
    }
  };

  GetAccountVehicleCreditsHistory = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.account.view",
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

      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .min(1, { message: "VIN No cannot be empty" }),
        starttime: z
          .number({ message: "Invalid Start Time format" })
          .min(1000000000000, { message: "Start Time is invalid" })
          .max(9999999999999, { message: "Start Time is invalid" }),
        endtime: z
          .number({ message: "Invalid End Time format" })
          .min(1000000000000, { message: "End Time is invalid" })
          .max(9999999999999, { message: "End Time is invalid" }),
      });

      const { accountid, vinno, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.params.accountid,
          vinno: req.params.vinno,
          starttime: Number(req.query.starttime || 0),
          endtime: Number(req.query.endtime || 0),
        }
      );

      let result =
        await this.accountHdlrImpl.GetAccountVehicleCreditsHistoryLogic(
          accountid,
          vinno,
          starttime,
          endtime
        );

      APIResponseOK(
        req,
        res,
        result,
        "Account vehicle credits history fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetAccountVehicleCreditsHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          e,
          "Failed to get account vehicle credits history"
        );
      }
    }
  };

  GetAccountAllFleetsCreditsHistory = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.account.view",
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

      const { accountid, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        starttime: Number(req.query.starttime || 0),
        endtime: Number(req.query.endtime || 0),
      });

      let result =
        await this.accountHdlrImpl.GetAccountAllFleetsCreditsHistoryLogic(
          accountid,
          starttime,
          endtime
        );

      APIResponseOK(
        req,
        res,
        result,
        "Account all fleets credits history fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetAccountAllFleetsCreditsHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          e,
          "Failed to get account all fleets credits history"
        );
      }
    }
  };

  ListAccountVehicles = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.account.view",
          "consolemgmt.accountvehicle.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get account vehicles."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),
      });

      let { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });

      let result = await this.accountHdlrImpl.ListAccountVehiclesLogic(
        accountid
      );

      APIResponseOK(req, res, result, "Account vehicles fetched successfully");
    } catch (e) {
      this.logger.error("ListAccountVehicles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "GET_ACCOUNT_VEHICLES_ERR",
          e.toString(),
          "Get account vehicles failed"
        );
      }
    }
  };

  SubscribeVehicles = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        updatedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),

        vinnos: z
          .array(
            z
              .string({ message: "Invalid VIN No format" })
              .nonempty({ message: "VIN NO cannot be empty" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message:
                  "VIN NO must contain only letters, numbers, and spaces, and must not start or end with a space",
              })
          )
          .min(1, { message: "At least one VIN is required" }),
      });

      let { accountid, updatedby, vinnos } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        updatedby: req.userid,
        vinnos: req.body.vinnos,
      });
      if (!vinnos || !Array.isArray(vinnos) || vinnos.length === 0) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_VINNOS",
          "Invalid VIN numbers"
        );
        return;
      }
      const result = await this.accountHdlrImpl.SubscribeVehiclesLogic(
        accountid,
        vinnos,
        updatedby
      );

      APIResponseOK(req, res, result, "Vehicles subscribed successfully");
    } catch (e) {
      this.logger.error("SubscribeVehicles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "SUBSCRIBE_VEHICLES_ERR",
          e.toString(),
          "Subscribe vehicles failed"
        );
      }
    }
  };

  UnsubscribeVehicle = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        updatedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),

        vinno: z
          .string({ message: "VIN number is required" })
          .nonempty({ message: "VIN number cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN NO must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN number must be at most 128 characters" }),
      });

      const { accountid, updatedby, vinno } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        updatedby: req.userid,
        vinno: req.body.vinno,
      });

      const result = await this.accountHdlrImpl.UnsubscribeVehicleLogic(
        accountid,
        vinno,
        updatedby
      );

      APIResponseOK(req, res, result, "Vehicle unsubscribed successfully");
    } catch (e) {
      this.logger.error("UnsubscribeVehicle error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UNSUBSCRIBE_VEHICLE_ERR",
          e.toString(),
          "Unsubscribe vehicle failed"
        );
      }
    }
  };

  CheckChangeSubscriptionPackage = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountpkg.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to check change subscription package."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        newpkgid: z
          .string({ message: "Invalid New Package format" })
          .uuid({ message: "Invalid New Package format" }),
      });

      let { accountid, newpkgid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        newpkgid: req.body.newpkgid,
      });

      let result =
        await this.accountHdlrImpl.CheckChangeSubscriptionPackageLogic(
          accountid,
          newpkgid
        );

      APIResponseOK(
        req,
        res,
        result,
        "Check change subscription package success"
      );
    } catch (e) {
      this.logger.error("CheckChangeSubscriptionPackage error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.message === "INVALID_PACKAGE_ID" ||
        e.message === "PACKAGE_NOT_FOUND"
      ) {
        return APIResponseBadRequest(
          req,
          res,
          e.message,
          {},
          "Invalid package id or package not found"
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CHECK_CHANGE_SUBSCRIPTION_PACKAGE_ERR",
          e.toString(),
          "Check change subscription package failed"
        );
      }
    }
  };

  ChangeSubscriptionPackage = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.accountpkg.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to change subscription package."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        newpkgid: z
          .string({ message: "New package ID is required" })
          .uuid({ message: "New package ID must be a valid UUID" }),
        updatedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });
      let { accountid, newpkgid, updatedby } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        newpkgid: req.body.newpkgid,
        updatedby: req.userid,
      });

      let result = await this.accountHdlrImpl.ChangeSubscriptionPackageLogic(
        accountid,
        newpkgid,
        updatedby
      );

      APIResponseOK(
        req,
        res,
        result,
        "Subscription package changed successfully"
      );
    } catch (e) {
      this.logger.error("ChangeSubscriptionPackage error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "SAME_PACKAGE_ID" ||
        e.errcode === "MULTIPLE_SUBSCRIPTIONS_FOUND" ||
        e.errcode === "INVALID_PACKAGE_ID" ||
        e.errcode === "PACKAGE_NOT_FOUND" ||
        e.errcode === "NO_ACCOUNT_CREDITS" ||
        e.errcode === "INSUFFICIENT_CREDITS" ||
        e.errcode === "FAILED_TO_UPDATE_SUBSCRIPTION" ||
        e.errcode === "FAILED_TO_CREATE_SUBSCRIPTION" ||
        e.errcode === "FAILED_TO_CREATE_SUBSCRIPTION_HISTORY" ||
        e.errcode === "FAILED_TO_RETRIEVE_SUBSCRIPTION_HISTORY"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, {}, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CHANGE_SUBSCRIPTION_PACKAGE_ERR",
          e.toString(),
          "Change subscription package failed"
        );
      }
    }
  };

  GetSubscriptionHistory = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.account.view",
          "consolemgmt.accountpkg.admin",
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
      let schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),
      });
      let { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });
      let result = await this.accountHdlrImpl.GetSubscriptionHistoryLogic(
        accountid
      );

      APIResponseOK(
        req,
        res,
        result,
        "Subscription history fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetSubscriptionHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "GET_SUBSCRIPTION_HISTORY_ERR",
          e.toString(),
          "Get subscription history failed"
        );
      }
    }
  };

  GetAllFleetsWithVinInfo = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Account ID must be a valid UUID" }),
      });
      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;
      let { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });
      let fleets = await this.accountHdlrImpl.GetAllFleetsWithVinInfoLogic(
        accountid,
        recursive
      );
      APIResponseOK(req, res, fleets);
    } catch (e) {
      this.logger.error("GetAllFleetsWithVinInfo error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(req, res, e);
      }
    }
  };

  AddVehicleToAccount = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, ["consolemgmt.accountvehicle.admin"])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to add vehicle to account."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        assignedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN NO must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),

        regno: z
          .string({ message: "Invalid Registration Number format" })
          .max(128, {
            message: "Registration Number must not exceed 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "Registration Number must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .optional()
          .nullable(),

        isowner: z.boolean({ message: "isowner must be a boolean" }),
        accvininfo: z
          .record(z.any(), { message: "accvininfo must be an object" })
          .default({}),
      });

      let processedregno = req.body.vehicleinfo?.regno
        ? req.body.vehicleinfo.regno.trim()
        : "";

      let { accountid, assignedby, vinno, regno, isowner, accvininfo } =
        validateAllInputs(schema, {
          accountid: req.params.accountid,
          vinno: req.params.vinno,
          assignedby: req.userid,
          regno: processedregno,
          isowner: req.body.vehicleinfo?.isowner,
          accvininfo: req.body.vehicleinfo?.accvininfo,
        });

      let vehicleinfo = { vinno, regno, isowner, accvininfo };

      let result = await this.accountHdlrImpl.AddVehicleToAccountLogic(
        accountid,
        vehicleinfo,
        assignedby
      );

      APIResponseOK(req, res, result, "Vehicle added to account successfully");
    } catch (e) {
      this.logger.error("AddVehicleToAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "VEHICLE_NOT_FOUND" ||
        e.errcode === "VEHICLE_ALREADY_IN_ACCOUNT" ||
        e.errcode === "ACCOUNT_NOT_FOUND"
      ) {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ADD_VEHICLE_TO_ACCOUNT_ERR",
          e.toString(),
          "Add vehicle to account failed"
        );
      }
    }
  };

  RemoveVehicleFromAccount = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, ["consolemgmt.accountvehicle.admin"])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to remove vehicle from account."
        );
      }

      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN NO must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),

        removedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      let { accountid, vinno, removedby } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        vinno: req.params.vinno,
        removedby: req.userid,
      });

      let result = await this.accountHdlrImpl.RemoveVehicleFromAccountLogic(
        accountid,
        vinno,
        removedby
      );

      APIResponseOK(
        req,
        res,
        result,
        "Vehicle removed from account successfully"
      );
    } catch (e) {
      this.logger.error("RemoveVehicleFromAccount error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "VEHICLE_NOT_FOUND") {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else if (e.errcode === "VEHICLE_NOT_IN_FLEET") {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else if (e.errcode === "VEHICLE_NOT_OWNED") {
        APIResponseBadRequest(req, res, e.errcode, null, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "REMOVE_VEHICLE_FROM_ACCOUNT_ERR",
          e.toString(),
          "Remove vehicle from account failed"
        );
      }
    }
  };

  ListAssignableVehicles = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, ["consolemgmt.accountvehicle.admin"])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list assignable vehicles."
        );
      }
      const schema = z.object({
        accountid: z
          .string({ message: "Account ID is required" })
          .uuid({ message: "Account ID must be a valid UUID" }),
      });

      const { accountid } = validateAllInputs(schema, {
        accountid: req.params.accountid,
      });

      let result = await this.accountHdlrImpl.ListAssignableVehiclesLogic(
        accountid
      );
      APIResponseOK(
        req,
        res,
        result,
        "Assignable vehicles fetched successfully"
      );
    } catch (error) {
      this.logger.error("ListAssignableVehicles error: ", error);
      if (error.errcode === "INPUT_ERROR") {
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
          "LIST_ASSIGNABLE_VEHICLES_ERR",
          error.toString(),
          "List assignable vehicles failed"
        );
      }
    }
  };

  ListPendingAccounts = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.account.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list pending accounts."
        );
      }
      let schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine(
            (val) => !val || val.length === 0 || val.length >= 3,
            { message: "Search text must be at least 3 characters long" }
          ),
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(1000),
        orderbyfield: z
          .string({ message: "Order by field is required" })
          .optional()
          .nullable()
          .default("createdat"),
        orderbydirection: z
          .string({ message: "Order by direction is required" })
          .optional()
          .nullable()
          .default("desc"),
        download: z
          .boolean({ message: "Download must be a boolean" })
          .optional()
          .default(false),
      });
      const parsedownload = req.query.download === "true";
      let { searchtext, offset, limit, orderbyfield, orderbydirection, download } =
        validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
        download: parsedownload,
      });
      let result = await this.accountHdlrImpl.ListPendingAccountsLogic(
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download
      );
      APIResponseOK(req, res, result, "Pending accounts listed successfully");
    } catch (e) {
      this.logger.error("ListPendingAccounts error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_PENDING_ACCOUNTS_ERR",
          e.toString(),
          "List pending accounts failed"
        );
      }
    }
  };

  ListDoneAccounts = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.account.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list done accounts."
        );
      }
      let schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine(
            (val) => !val || val.length === 0 || val.length >= 3,
            { message: "Search text must be at least 3 characters long" }
          ),
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(1000),
        orderbyfield: z
          .string({ message: "Order by field is required" })
          .optional()
          .nullable()
          .default("createdat"),
        orderbydirection: z
          .string({ message: "Order by direction is required" })
          .optional()
          .nullable()
          .default("desc"),
        download: z
          .boolean({ message: "Download must be a boolean" })
          .optional()
          .default(false),
      });
      const parsedownload = req.query.download === "true";
      let { searchtext, offset, limit, orderbyfield, orderbydirection, download } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
        download: parsedownload,
      });
      let result = await this.accountHdlrImpl.ListDoneAccountsLogic(
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download
      );
      APIResponseOK(req, res, result, "Done accounts listed successfully");
    } catch (e) {
      this.logger.error("ListDoneAccounts error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_DONE_ACCOUNTS_ERR",
          e.toString(),
          "List done accounts failed"
        );
      }
    }
  };

  IsAccountNameAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        accountname: z
          .string({ message: "Account name must be a string" })
          .nonempty({ message: "Account name cannot be empty" }),
      });
      let { accountname } = validateAllInputs(schema, {
        accountname: req.body.accountname,
      });
      let result = await this.accountHdlrImpl.IsAccountNameAvailableLogic(
        accountname
      );
      if (result) {
        return APIResponseOK(req, res, result, "Account name available");
      } else {
        return APIResponseOK(req, res, result, "Account name not available");
      }
    } catch (e) {
      this.logger.error("IsAccountNameAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(req, res, e);
      }
    }
  };
  ListAllAccounts = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.view",
          "consolemgmt.account.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list accounts."
        );
      }
      let result = await this.accountHdlrImpl.ListAllAccountsLogic();
      APIResponseOK(req, res, result, "Accounts fetched successfully");
    } catch (e) {
      this.logger.error("ListAccounts error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_ACCOUNTS_ERR",
        e.toString(),
        "List accounts failed"
      );
    }
  };

  CreateCorporateAccount = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, ["consolemgmt.account.admin"], "all")
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create account."
        );
      }

      const schema = z.object({
        accountname: z
          .string({ message: "Invalid Account Name format" })
          .nonempty({ message: "Account Name cannot be empty" })
          .max(128, {
            message: "Account Name must be at most 128 characters long",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _\-&]*[A-Za-z0-9])?$/, {
            message:
              "Account name can only contain letters, numbers, spaces, hyphens, underscores, and ampersand",
          }),
        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
        mobile: z
          .string({ message: "Mobile must be a string" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          })
          .optional()
          .nullable(),
        email: z
          .string({ message: "Email must be a string" })
          .email({ message: "Invalid Email format" })
          .optional()
          .nullable(),
        createdby: z
          .string({ message: "Created by must be a string" })
          .uuid({ message: "Invalid Created by format" })
          .optional(),
        accountcategory: z
          .enum(["individual", "corporate", "aggregator", "financier"], {
            errorMap: () => ({ message: "Invalid Account Category" }),
          })
          .default("individual"),        
      });

      const { accountname, isenabled, mobile, email, createdby, accountcategory } =
        validateAllInputs(schema, {
          accountname: req.body.accountname,
          isenabled: req.body.isenabled,
          mobile: req.body.mobile,
          email: req.body.email,
          createdby: req.userid,
          accountcategory: req.body.accountcategory,
        });

      let result = await this.accountHdlrImpl.CreateCorporateAccountLogic(
        accountname,
        email,
        mobile,
        isenabled,
        createdby,
        accountcategory
      );
      if (result.alreadyExists) {
        delete result.alreadyExists;
        return APIResponseOK(req, res, result, "Account already exists");
      } else {
        return APIResponseOK(req, res, result, "Account created successfully");
      }
    } catch (error) {
      this.logger.error("CreateAccount error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (error.errcode === "ACCOUNT_ALREADY_EXISTS") {
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
          "CREATE_ACCOUNT_ERR",
          error.toString(),
          "Create account failed"
        );
      }
    }
  };

  AccountsAvailableForTagging = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.view",
          "consolemgmt.account.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list accounts."
        );
      }
      let schema = z.object({
        vinno: z
          .string({ message: "VIN No must be a string" })
          .min(1, { message: "VIN No cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN No can only contain letters, numbers, and spaces",
          })
          .max(128, {
            message: "VIN No must be at most 128 characters long",
          }),
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine(
            (val) => !val || val.length === 0 || val.length >= 3,
            { message: "Search text must be at least 3 characters long" }
          ),
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(1000),
      });
      let { vinno, searchtext, offset, limit } = validateAllInputs(schema, {
        vinno: req.query.vinno,
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
      });
      let result = await this.accountHdlrImpl.AccountsAvailableForTaggingLogic(vinno, searchtext, offset, limit);
      APIResponseOK(req, res, result, "Accounts available for tagging fetched successfully");
    } catch (e) {
      this.logger.error("AccountsAvailableForTagging error: ", e);
      if(e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          e.errcode,
          e.errdata,
          e.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ACCOUNTS_AVAILABLE_FOR_TAGGING_ERR",
          e.toString(),
          "Accounts available for tagging failed"
        );
      }
    }
  };

  GetAccountCategory = async (req, res, next) => {
    try {
      let result = await this.accountHdlrImpl.GetAccountCategoryLogic();
      APIResponseOK(req, res, result, "Account category fetched successfully");
    } catch (e) {
      this.logger.error("GetAccountCategory error: ", e);
      APIResponseInternalErr(req, res, e);
    }
  };
}
