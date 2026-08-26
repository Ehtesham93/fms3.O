import crypto from "crypto";
import promiserouter from "express-promise-router";
import z from "zod";
import { validateAllInputs } from "../../../app/utils/validationutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../utils/responseutil.js";
import { AuthenticateUserTokenFromCookie } from "../../utils/tokenutil.js";
import AccountHdlr from "./account/accounthdlr.js";
import ModelHdlr from "./model/modelhdlr.js";
import ModuleHdlr from "./module/modulehdlr.js";
import PackageHdlr from "./pacakge/packagehdlr.js";
import PlatformHdlrImpl from "./platformhdlr_impl.js";
import RoleHdlr from "./role/rolehdlr.js";
import PUserHdlr from "./user/puserhdlr.js";
import VehicleHdlr from "./vehicle/vehiclehdlr.js";
import MetaHdlr from "./meta/metahdlr.js";
import SubscriptionHdlr from "./subscription/subscriptionhdlr.js";
import { CheckUserPerms } from "../../utils/permissionutil.js";
import { CheckUserStatusMiddleware } from "../../utils/permissionutil.js";
export default class PlatformHdlr {
  constructor(
    platformSvcI,
    userSvcI,
    authSvcI,
    fmsAccountSvcI,
    historyDataSvcI,
    inMemCacheI,
    redisSvc,
    logger
  ) {
    this.platformSvcI = platformSvcI;
    this.userSvcI = userSvcI;
    this.authSvcI = authSvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.historyDataSvcI = historyDataSvcI;
    this.inMemCacheI = inMemCacheI;
    this.redisSvc = redisSvc;
    this.logger = logger;
    this.platformHdlrImpl = new PlatformHdlrImpl(
      platformSvcI,
      userSvcI,
      authSvcI,
      fmsAccountSvcI,
      platformSvcI.getAccountSvc(),
      platformSvcI.getPUserSvc(),
      logger
    );
    this.moduleHdlr = new ModuleHdlr(
      platformSvcI.getModuleSvc(),
      userSvcI,
      logger
    );
    this.packageHdlr = new PackageHdlr(platformSvcI.getPackageSvc(), logger);
    this.accountHdlr = new AccountHdlr(
      platformSvcI.getAccountSvc(),
      userSvcI,
      authSvcI,
      fmsAccountSvcI,
      platformSvcI,
      inMemCacheI,
      redisSvc,
      logger
    );
    this.pUserHdlr = new PUserHdlr(
      platformSvcI.getPUserSvc(),
      userSvcI,
      platformSvcI.getAccountSvc(),
      fmsAccountSvcI,
      authSvcI,
      platformSvcI,
      this.accountHdlr,
      inMemCacheI,
      logger
    );
    this.roleHdlr = new RoleHdlr(platformSvcI.getRoleSvc(), logger);
    this.modelHdlr = new ModelHdlr(
      platformSvcI.getModelSvc(),
      userSvcI,
      logger
    );
    this.vehicleHdlr = new VehicleHdlr(platformSvcI, historyDataSvcI, fmsAccountSvcI, platformSvcI.getMetaSvc(), redisSvc, logger);
    this.metaHdlr = new MetaHdlr(platformSvcI.getMetaSvc(), logger);
    this.subscriptionHdlr = new SubscriptionHdlr(platformSvcI.getSubscriptionSvc(), logger);
  }

  GetUserPermsHelper = async (req, res, next) => {
    try {
      const userid = req.userid;
      let userPerms = await this.userSvcI.GetConsolePerms(userid);
      let showConsole = false;

      if (userPerms && userPerms.length > 0) {
        showConsole = true;
      }

      if (!showConsole) {
        APIResponseForbidden(
          req,
          res,
          "CONSOLE_ACCESS_DENIED",
          null,
          "User does not have console access permissions"
        );
        return;
      }

      req.userperms = userPerms;
      next();
    } catch (error) {
      this.logger.error("GetUserPermsHelper error: ", error);
      APIResponseInternalErr(
        req,
        res,
        "CONSOLE_PERMISSION_CHECK_ERR",
        error.toString(),
        "Console permission check failed"
      );
    }
  };

  RegisterRoutes(router) {
    let modelRouter = promiserouter();
    modelRouter.use(AuthenticateUserTokenFromCookie);
    modelRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.modelHdlr.RegisterNoPermsRoutes(modelRouter);

    modelRouter.use(this.GetUserPermsHelper);
    this.modelHdlr.RegisterRoutes(modelRouter);
    router.use("/model", modelRouter);

    let metaRouter = promiserouter();
    metaRouter.use(AuthenticateUserTokenFromCookie);
    metaRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.metaHdlr.RegisterRoutes(metaRouter);
    router.use("/meta", metaRouter);

    let subscriptionRouter = promiserouter();
    subscriptionRouter.use(AuthenticateUserTokenFromCookie);
    subscriptionRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.subscriptionHdlr.RegisterRoutes(subscriptionRouter);
    router.use("/subscription", subscriptionRouter);

    const authRouter = promiserouter();
    authRouter.use(AuthenticateUserTokenFromCookie);
    authRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    // this api does not need console permission check
    authRouter.get("/apikey", this.GetAPIKey);

    authRouter.use(this.GetUserPermsHelper);
    authRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    router.use("/", authRouter);

    // console
    authRouter.get("/home", this.GetConsoleHomePage);
    authRouter.get("/modules", this.GetConsoleModules);
    authRouter.get("/overview", this.GetConsolePlatformOverview);
    authRouter.get(
      "/overviewanalytics",
      this.GetConsolePlatformOverviewAnalytics
    );
    authRouter.get(
      "/account/:accountid/assignmenthistory",
      this.GetConsoleAccountAssignmentHistory
    );
    authRouter.get(
      "/vehicle/:vinno/assignmenthistory",
      this.GetConsoleVehicleAssignmentHistory
    );
    router.post("/review/discard", this.DiscardReview);
    // module
    let moduleRouter = promiserouter();
    moduleRouter.use(AuthenticateUserTokenFromCookie);
    moduleRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.moduleHdlr.RegisterRoutes(moduleRouter);
    router.use("/module", moduleRouter);

    // packages
    let packageRouter = promiserouter();
    packageRouter.use(AuthenticateUserTokenFromCookie);
    packageRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.packageHdlr.RegisterRoutes(packageRouter);
    router.use("/pkg", packageRouter);

    //roles
    let roleRouter = promiserouter();
    roleRouter.use(AuthenticateUserTokenFromCookie);
    roleRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.roleHdlr.RegisterRoutes(roleRouter);
    router.use("/role", roleRouter);

    // users
    let pUserRouter = promiserouter();
    pUserRouter.use(AuthenticateUserTokenFromCookie);
    pUserRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.pUserHdlr.RegisterRoutes(pUserRouter);
    router.use("/user", pUserRouter);

    // accounts
    let accountRouter = promiserouter();
    accountRouter.use(AuthenticateUserTokenFromCookie);
    accountRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.accountHdlr.RegisterRoutes(accountRouter);
    router.use("/account", accountRouter);

    // vehicles
    let vehicleRouter = promiserouter();
    vehicleRouter.use(AuthenticateUserTokenFromCookie);
    vehicleRouter.use(CheckUserStatusMiddleware(this.userSvcI, this.logger));
    this.vehicleHdlr.RegisterRoutes(vehicleRouter);
    router.use("/vehicle", vehicleRouter);
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

  GetConsoleHomePage = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.userid,
      });

      let result = await this.platformHdlrImpl.GetConsolePermissionsLogic(
        userid
      );
      APIResponseOK(req, res, result, "Console home page fetched successfully");
    } catch (e) {
      this.logger.error("GetConsoleHomePage error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_CONSOLE_HOME_PAGE_ERR",
          e.toString(),
          "Get console home page failed"
        );
      }
    }
  };

  GetConsoleModules = async (req, res, next) => {
    try {
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      let { userid } = validateAllInputs(schema, {
        userid: req.userid,
      });

      let result = await this.platformHdlrImpl.GetConsoleModulesLogic(userid);

      APIResponseOK(
        req,
        res,
        result,
        "Console permissions fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetConsoleModules error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_CONSOLE_PERMISSIONS_ERR",
          e.toString(),
          "Get console permissions failed"
        );
      }
    }
  };

  GetAPIKey = async (req, res, next) => {
    try {
      let schema = z.object({
        platform: z.enum(["web", "ios", "android"], {
          errorMap: () => ({
            message: "Platform must be one of: web, ios, android",
          }),
        }),
        environment: z.enum(["staging", "development", "production", "local"], {
          errorMap: () => ({
            message:
              "Environment must be one of: staging, development, production, local",
          }),
        }),
      });

      let { platform, environment } = validateAllInputs(schema, {
        platform: req.query.platform,
        environment: req.query.environment,
      });

      let result = await this.platformHdlrImpl.GetAPIKeyLogic(
        platform,
        environment
      );

      APIResponseOK(req, res, result, "API key fetched successfully");
    } catch (e) {
      this.logger.error("GetAPIKey error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_KEY_ERR",
          e.toString(),
          "Get key failed"
        );
      }
    }
  };

  GetConsolePlatformOverview = async (req, res) => {
    try {
      let result =
        await this.platformHdlrImpl.GetConsolePlatformOverviewLogic();
      APIResponseOK(req, res, result, "Platform overview fetched successfully");
    } catch (e) {
      APIResponseInternalErr(
        req,
        res,
        "GET_PLATFORM_OVERVIEW_ERR",
        e.toString(),
        "Get platform overview failed"
      );
    }
  };

  GetConsolePlatformOverviewAnalytics = async (req, res) => {
    try {
      let result;
      const url = req.protocol + "://" + req.get("host") + req.originalUrl;
      const fullUrl = `${url}`;
      const redisKey = crypto
        .createHash("sha256")
        .update(JSON.stringify(fullUrl))
        .digest("hex");
      const redisSvc = this.redisSvc;
      try {
        const [cachedData, redisError] = await redisSvc.get(redisKey);
        if (redisError) {
          this.logger.error("Redis error:", redisError);
        } else if (cachedData !== null) {
          result = JSON.parse(cachedData);
          APIResponseOK(req, res, result, "SUCCESS");
          return;
        }
      } catch (redisErr) {
        this.logger.error("Redis connection error:", redisErr);
      }

      result =
        await this.platformHdlrImpl.GetConsolePlatformOverviewAnalyticsLogic();

      if (result instanceof Error) {
        result = [];
      }
      if (result && Object.keys(result).length > 0) {
        try {
          const [setResult, setError] = await redisSvc.set(
            redisKey,
            JSON.stringify(result),
            1800
          );
          if (setError) {
            this.logger.error("Failed to cache data:", setError);
          } else {
            this.logger.info("Data cached successfully", setResult);
          }
        } catch (cacheErr) {
          this.logger.error("Failed to cache data:", cacheErr);
        }
      }
      APIResponseOK(req, res, result, "Platform overview fetched successfully");
    } catch (e) {
      APIResponseInternalErr(
        req,
        res,
        "GET_PLATFORM_OVERVIEW_ERR",
        e.toString(),
        "Get platform overview failed"
      );
    }
  };

  GetConsoleVehicleAssignmentHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        vinno: z
          .string({ message: "Invalid VIN number" })
          .nonempty({ message: "VIN number cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN must be a valid format",
          })
          .max(128, { message: "VIN number must not exceed 128 characters" }),
        starttime: z.number({ message: "Invalid Start Time format" }),
        endtime: z.number({ message: "Invalid End Time format" }),
      });

      let { vinno, starttime, endtime } = validateAllInputs(schema, {
        vinno: req.params.vinno,
        starttime: Number(req.query.starttime || 0),
        endtime: Number(req.query.endtime || 0),
      });

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
        await this.platformHdlrImpl.GetConsoleVehicleAssignmentHistoryLogic(
          vinno,
          startepoch,
          endepoch
        );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle assignment history fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetConsoleVehicleAssignmentHistory error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "GET_VEHICLE_ASSIGNMENT_HISTORY_ERR",
        e.toString(),
        "Get vehicle assignment history failed"
      );
    }
  };

  GetConsoleAccountAssignmentHistory = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        starttime: z.number({ message: "Invalid Start Time format" }),
        endtime: z.number({ message: "Invalid End Time format" }),
      });

      let { accountid, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.params.accountid,
        starttime: Number(req.query.starttime || 0),
        endtime: Number(req.query.endtime || 0),
      });

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
        await this.platformHdlrImpl.GetConsoleAccountAssignmentHistoryLogic(
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
      this.logger.error("GetConsoleAccountAssignmentHistory error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "GET_ACCOUNT_ASSIGNMENT_HISTORY_ERR",
        e.toString(),
        "Get account assignment history failed"
      );
    }
  };

  DiscardReview = async (req, res) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.platform.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to discard review."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        taskid: z
          .string({ message: "Invalid Task ID format" })
          .uuid({ message: "Invalid Task ID format" }),
        type: z.enum(["account", "user", "vehicle"], {
          errorMap: () => ({
            message: "Type must be one of: account, user, vehicle",
          }),
        }),
      });
      let { userid, taskid, type } = validateAllInputs(schema, {
        userid: req.userid,
        taskid: req.body.taskid,
        type: req.body.type,
      });
      let result = await this.platformHdlrImpl.DiscardReviewLogic(
        userid,
        taskid,
        type
      );
      APIResponseOK(req, res, result, result.message);
    } catch (e) {
      this.logger.error("DiscardReview error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(req, res, e.errcode, e.errdata, e.message);
      }
    }
  };
}
