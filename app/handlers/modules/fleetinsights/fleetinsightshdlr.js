import crypto from "crypto";
import promiserouter from "express-promise-router";
import z from "zod";
import {
  APIResponseBadRequest,
  APIResponseInternalErr,
  APIResponseOK,
  APIResponseUnauthorized,
  APIResponseForbidden,
} from "../../../utils/responseutil.js";
import { AuthenticateAccountTokenFromCookie } from "../../../utils/tokenutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import FleetInsightsHdlrImpl from "./fleetinsightshdlr_impl.js";
import PermissionSvc from "../../../services/permsvc/permsvc.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import { Sleep } from "../../../utils/commonutil.js";
export default class FleetInsightsHdlr {
  constructor(
    fleetInsightsSvcI,
    fmsAccountSvcI,
    userSvcI,
    logger,
    redisSvc,
    config
  ) {
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.logger = logger;
    this.fleetInsightsHdlrImpl = new FleetInsightsHdlrImpl(
      fleetInsightsSvcI,
      fmsAccountSvcI,
      logger
    );
    this.permissionSvc = new PermissionSvc(fmsAccountSvcI, userSvcI, logger);
    this.redisSvc = redisSvc;
    this.config = config;
  }

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

  // TODO: add permission check for each route
  RegisterRoutes(router) {
    const accountTokenGroup = promiserouter();
    accountTokenGroup.use(AuthenticateAccountTokenFromCookie);
    accountTokenGroup.use(this.VerifyUserAccountAccess);
    if (this.config?.fmsFeatures?.enableCreditChecks) {
      accountTokenGroup.use(this.CheckEnoughCredits);
    }

    router.use("/", accountTokenGroup);

    accountTokenGroup.get("/getallfleets", this.GetAllFleets);
    accountTokenGroup.get("/getaccountoverview", this.GetAccountOverview);
    accountTokenGroup.get("/getfleetage", this.GetFleetAge);
    accountTokenGroup.get("/getfleetanalytics", this.GetFleetAnalytics);
    accountTokenGroup.get("/getfleetutilization", this.GetFleetUtilization);
    accountTokenGroup.get(
      "/fleet/:fleetid/allinsights",
      this.ValidateFleetAccess,
      this.GetAllFleetInsights
    );
    accountTokenGroup.post("/vehicle/allinsights", this.GetAllVehicleInsights);
    accountTokenGroup.post(
      "/vehicle/ecocontribution",
      this.GetVehicleEcoContribution
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/ecocontribution",
      this.ValidateFleetAccess,
      this.GetFleetVehicleEcoContribution
    );
  }

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
      this.logger.error("VerifyUserAccountAccess error: ", error);
      APIResponseInternalErr(
        req,
        res,
        "FAILED_TO_VERIFY_USER_ACCOUNT_ACCESS",
        {},
        "Failed to verify user account access"
      );
    }
  };

  ValidateFleetAccess = async (req, res, next) => {
    try {
      const { accountid } = req;
      const { fleetid } = req.params;

      if (!fleetid) {
        APIResponseBadRequest(
          req,
          res,
          "MISSING_FLEET_ID",
          null,
          "Fleet ID is required"
        );
        return;
      }

      const fleetIdRegex =
        /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
      if (!fleetIdRegex.test(fleetid)) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_FLEET_ID_FORMAT",
          null,
          "Fleet ID must be a valid UUID format"
        );
        return;
      }

      const fleetInfo = await this.fmsAccountSvcI.GetFleetInfo(
        accountid,
        fleetid
      );

      if (!fleetInfo) {
        APIResponseBadRequest(
          req,
          res,
          "FLEET_NOT_FOUND",
          null,
          "Fleet not found or does not belong to this account"
        );
        return;
      }

      req.fleetInfo = fleetInfo;

      next();
    } catch (error) {
      this.logger.error("ValidateFleetAccess error: ", error);
      APIResponseInternalErr(
        req,
        res,
        "FLEET_VALIDATION_ERROR",
        {},
        "Failed to validate fleet access"
      );
    }
  };

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

  GetAllFleets = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
      });

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.query.fleetid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet analytics."
        );
      }

      let fleets = await this.fleetInsightsHdlrImpl.GetAllFleetsLogic(
        accountid,
        fleetid,
        recursive
      );

      APIResponseOK(req, res, fleets);
    } catch (error) {
      this.logger.error("GetAllFleets error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_ALL_FLEETS",
          {},
          "Failed to get all fleets"
        );
      }
    }
  };

  GetAccountOverview = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
      });
      const { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.query.fleetid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet insights overview."
        );
      }

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let overview = await this.fleetInsightsHdlrImpl.GetAccountOverviewLogic(
        accountid,
        fleetid,
        recursive
      );
      APIResponseOK(req, res, overview);
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
          "FAILED_TO_GET_ACCOUNT_OVERVIEW",
          {},
          "Failed to get account overview"
        );
      }
    }
  };

  GetFleetAge = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
      });
      const { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.query.fleetid,
      });
      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet overview."
        );
      }

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let age = await this.fleetInsightsHdlrImpl.GetFleetAgeLogic(
        accountid,
        fleetid,
        recursive
      );
      APIResponseOK(req, res, age);
    } catch (error) {
      this.logger.error("GetFleetAge error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_FLEET_AGE",
          {},
          "Failed to get fleet age"
        );
      }
    }
  };

  GetAllFleetInsights = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
        starttime: z.string({ message: "Start Time is invalid" }),
        endtime: z.string({ message: "End Time is invalid" }),
      });

      const recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;
      const filter = req.query.filter || "";

      const { accountid, fleetid, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          starttime: req.query.starttime,
          endtime: req.query.endtime,
        }
      );

      const startepoch = this.ValidateEpochTime(starttime, "starttime");
      const endepoch = this.ValidateEpochTime(endtime, "endtime");

      if (startepoch >= endepoch) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "starttime must be less than endtime"
        );
        return;
      }

      if (endtime - starttime > 35 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 35 days"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet insights."
        );
      }

      let result;
      const fullUrl = req.protocol + "://" + req.get("host") + req.originalUrl;
      const redisKey = `${fullUrl}.${starttime}.${endtime}`;
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

      result = await this.fleetInsightsHdlrImpl.GetFleetAllAnalytics(
        accountid,
        startepoch,
        endepoch,
        fleetid,
        recursive,
        filter
      );

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
            this.logger.info("Data cached successfully");
          }
        } catch (cacheErr) {
          this.logger.error("Failed to cache data:", cacheErr);
        }
      }

      APIResponseOK(req, res, result, "SUCCESS");
    } catch (error) {
      this.logger.error("GetAllFleetInsights error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_FLEET_ALL_INSIGHTS",
          {},
          "Failed to get fleet all insights"
        );
      }
    }
  };

  GetAllVehicleInsights = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinnumbers: z.union([
          z
            .string({ message: "Invalid VIN NO format" })
            .nonempty({ message: "VIN NO is required" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
              message:
                "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
            })
            .max(128, {
              message: "VIN NO must be at most 128 characters long",
            }),
          z
            .array(
              z
                .string({ message: "Invalid VIN NO format" })
                .nonempty({ message: "VIN NO is required" })
                .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                  message:
                    "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
                })
                .max(128, {
                  message: "VIN NO must be at most 128 characters long",
                })
            )
            .nonempty({ message: "At least one VIN NO must be provided" }),
        ]),
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
        filter: z.string({ message: "Filter is invalid" }).optional(),
      });

      const { accountid, vinnumbers, starttime, endtime, filter } =
        validateAllInputs(schema, {
          accountid: req.accountid,
          vinnumbers: req.body.vinnumbers,
          starttime: req.body.starttime,
          endtime: req.body.endtime,
          filter: req.body.filter,
        });

      if (starttime >= endtime) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "starttime must be less than endtime"
        );
        return;
      }

      if (endtime - starttime > 35 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 35 days"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet insights."
        );
      }

      const hash = crypto
        .createHash("sha256")
        .update(JSON.stringify(req.body))
        .digest("hex");
      const url = req.protocol + "://" + req.get("host") + req.originalUrl;
      const fullUrl = `${url}.${hash}`;
      const redisKey = crypto
        .createHash("sha256")
        .update(JSON.stringify(fullUrl))
        .digest("hex");
      const redisSvc = this.redisSvc;
      let result;

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

      result = await this.fleetInsightsHdlrImpl.GetVehicleAllAnalytics(
        accountid,
        starttime,
        endtime,
        vinnumbers,
        filter
      );

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
            this.logger.info("Data cached successfully");
          }
        } catch (cacheErr) {
          this.logger.error("Failed to cache data:", cacheErr);
        }
      }

      APIResponseOK(req, res, result, "SUCCESS");
    } catch (error) {
      this.logger.error("GetAllVehicleInsights error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_VEHICLE_ALL_INSIGHTS",
          {},
          "Failed to get vehicle all insights"
        );
      }
    }
  };

  GetFleetVehicleEcoContribution = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        vehiclematric: z
          .boolean({ message: "Vehicle Matric is invalid" })
          .optional(),
      });

      const { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet insights."
        );
      }

      const vehiclematric = req.query.vehiclematric
        ? req.query.vehiclematric === "true"
        : false;
      const recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      const analytics =
        await this.fleetInsightsHdlrImpl.GetFleetVehicleEcoContributionLogic(
          accountid,
          fleetid,
          vehiclematric,
          recursive
        );

      APIResponseOK(req, res, analytics, "SUCCESS");
    } catch (error) {
      this.logger.error("GetFleetVehicleEcoContribution error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_VEHICLE_ECO_CONTRIBUTION",
          {},
          "Failed to get vehicle eco contribution"
        );
      }
    }
  };

  GetVehicleEcoContribution = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinnumbers: z.union([
          z
            .string({ message: "Invalid VIN NO format" })
            .nonempty({ message: "VIN NO is required" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
              message:
                "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
            })
            .max(128, {
              message: "VIN NO must be at most 128 characters long",
            }),
          z
            .array(
              z
                .string({ message: "Invalid VIN NO format" })
                .nonempty({ message: "VIN NO is required" })
                .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                  message:
                    "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
                })
                .max(128, {
                  message: "VIN NO must be at most 128 characters long",
                })
            )
            .nonempty({ message: "At least one VIN NO must be provided" }),
        ]),
        vehiclematric: z
          .boolean({ message: "Vehicle Matric is invalid" })
          .optional(),
      });

      const { accountid, vinnumbers } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinnumbers: req.body.vinnumbers,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet insights."
        );
      }

      const vehiclematric = req.body.vehiclematric || false;

      const analytics =
        await this.fleetInsightsHdlrImpl.GetVehicleEcoContributionLogic(
          accountid,
          vinnumbers,
          vehiclematric
        );

      APIResponseOK(req, res, analytics, "SUCCESS");
    } catch (error) {
      this.logger.error("GetVehicleEcoContribution error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_VEHICLE_ECO_CONTRIBUTION",
          {},
          "Failed to get vehicle eco contribution"
        );
      }
    }
  };

  GetFleetAnalytics = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
        starttime: z.string({ message: "Start Time is invalid" }),
        endtime: z.string({ message: "End Time is invalid" }),
      });

      const recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      const { accountid, fleetid, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.query.fleetid,
          starttime: req.query.starttime,
          endtime: req.query.endtime,
        }
      );

      const startepoch = this.ValidateEpochTime(starttime, "starttime");
      const endepoch = this.ValidateEpochTime(endtime, "endtime");

      if (startepoch >= endepoch) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "starttime must be less than endtime"
        );
        return;
      }

      if (endtime - starttime > 35 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 35 days"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet analytics."
        );
      }

      let result;
      const fullUrl = req.protocol + "://" + req.get("host") + req.originalUrl;
      const redisKey = `${fullUrl}.${starttime}.${endtime}`;
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

      result = await this.fleetInsightsHdlrImpl.GetFleetAnalyticsLogic(
        accountid,
        startepoch,
        endepoch,
        fleetid,
        recursive
      );

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
            this.logger.info("Data cached successfully");
          }
        } catch (cacheErr) {
          this.logger.error("Failed to cache data:", cacheErr);
        }
      }

      APIResponseOK(req, res, result, "SUCCESS");
    } catch (error) {
      this.logger.error("GetFleetAnalytics error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_FLEET_ANALYTICS",
          {},
          "Failed to get fleet analytics"
        );
      }
    }
  };

  GetFleetUtilization = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
        starttime: z.string({ message: "Start Time is invalid" }),
        endtime: z.string({ message: "End Time is invalid" }),
      });

      const recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      const { accountid, fleetid, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.query.fleetid,
          starttime: req.query.starttime,
          endtime: req.query.endtime,
        }
      );

      const startepoch = this.ValidateEpochTime(starttime, "starttime");
      const endepoch = this.ValidateEpochTime(endtime, "endtime");

      if (startepoch >= endepoch) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIME_RANGE",
          {},
          "starttime must be less than endtime"
        );
        return;
      }

      if (endtime - starttime > 35 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 35 days"
        );
        return;
      }

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["fleetinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet analytics."
        );
      }

      let result;
      const fullUrl = req.protocol + "://" + req.get("host") + req.originalUrl;
      const redisKey = `${fullUrl}.${starttime}.${endtime}`;
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

      result = await this.fleetInsightsHdlrImpl.GetFleetUtilizationLogic(
        accountid,
        fleetid,
        startepoch,
        endepoch,
        recursive
      );

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
            this.logger.info("Data cached successfully");
          }
        } catch (cacheErr) {
          this.logger.error("Failed to cache data:", cacheErr);
        }
      }

      APIResponseOK(req, res, result, "SUCCESS");
    } catch (error) {
      this.logger.error("GetFleetUtilization error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
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
          "FAILED_TO_GET_FLEET_UTILIZATION",
          {},
          "Failed to get fleet utilization"
        );
      }
    }
  };
}
