import crypto from "crypto";
import promiserouter from "express-promise-router";
import z from "zod";
import PermissionSvc from "../../../services/permsvc/permsvc.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
  APIResponseUnauthorized,
} from "../../../utils/responseutil.js";
import { AuthenticateAccountTokenFromCookie } from "../../../utils/tokenutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import TripsinsighthdlrImpl from "./tripsinsightshdlr_impl.js";

export default class Tripsinsighthdlr {
  constructor(
    tripsinsightssvcI,
    fmsAccountSvcI,
    userSvcI,
    logger,
    redisSvc,
    config
  ) {
    this.tripsinsightssvcI = tripsinsightssvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.logger = logger;
    this.tripsinsightssvcHdlrImpl = new TripsinsighthdlrImpl(
      tripsinsightssvcI,
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

    // api without fleet validation
    accountTokenGroup.post("/vehicle/:vinno/trips", this.GetTripsByVehicle);
    accountTokenGroup.post("/vehicle/tripreport", this.GetVehicleTripReport);
    accountTokenGroup.get(
      "/vehicle/:vinno/activevehicledata",
      this.GetActiveVehicleDataByVin
    );
    accountTokenGroup.get(
      "/vehicle/:vinno/fleetutilizationheatmap",
      this.GetFleetUtilizationHeatMapForVehicle
    );
    accountTokenGroup.get(
      "/vehicle/:vinno/vehicledrivingmode",
      this.GetVehicleDrivingMode
    );
    accountTokenGroup.get(
      "/vehicle/:vinno/distancereport",
      this.GetVehicleDistanceReport
    );

    // api with fleet validation
    accountTokenGroup.post(
      "/fleet/:fleetid/trips",
      this.ValidateFleetAccess,
      this.GetTripsByFleet
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/activevehicles",
      this.ValidateFleetAccess,
      this.GetActiveVehiclesByFleet
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/fleetutilizationheatmap",
      this.ValidateFleetAccess,
      this.GetFleetUtilizationHeatMap
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/fleetdrivingmode",
      this.ValidateFleetAccess,
      this.GetFleetDrivingMode
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/tripreport",
      this.ValidateFleetAccess,
      this.GetFleetTripReport
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/overview",
      this.ValidateFleetAccess,
      this.GetFleetOverview
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/overview/listall",
      this.ValidateFleetAccess,
      this.GetFleetOverviewList
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/distancereport",
      this.ValidateFleetAccess,
      this.GetFleetDistanceReport
    );
  }

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

  GetTripsByVehicle = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN NO format" })
          .nonempty({ message: "VIN NO is required" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN NO must be at most 128 characters long" }),
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

      const { accountid, vinno, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          vinno: req.params.vinno,
          starttime: req.body.starttime,
          endtime: req.body.endtime,
        }
      );

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

      if (!CheckUserPerms(userPerms, ["tripinsights.reports.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle trip reports."
        );
      }

      let result = await this.tripsinsightssvcHdlrImpl.GetTripsByVehicleLogic(
        accountid,
        vinno,
        starttime,
        endtime
      );

      if (result instanceof Error) {
        result = [];
      }

      APIResponseOK(req, res, result, "Vehicle trips listed successfully");
    } catch (error) {
      this.logger.error("GetTripsByVehicle error: ", error);
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
          "FAILED_TO_GET_VEHICLE_TRIPS",
          {},
          "Failed to get vehicle trips"
        );
      }
    }
  };

  GetTripsByFleet = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),

        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),

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

      const { accountid, fleetid, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          starttime: req.body.starttime,
          endtime: req.body.endtime,
        }
      );

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
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["tripinsights.reports.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet trip reports."
        );
      }

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

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

      result = await this.tripsinsightssvcHdlrImpl.GetTripsByFleetLogic(
        accountid,
        fleetid,
        starttime,
        endtime,
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
            900
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

      APIResponseOK(req, res, result, "Fleet trips listed successfully");
    } catch (error) {
      this.logger.error("GetTripsByFleet error: ", error);
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
          "FAILED_TO_GET_FLEET_TRIPS",
          {},
          "Failed to get fleet trips"
        );
      }
    }
  };

  GetActiveVehicleDataByVin = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN number format" })
          .nonempty({ message: "VIN number cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN NO must be at most 128 characters long" }),
        starttime: z
          .string({ message: "Start Time is required" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" })
          .nonempty({ message: "Start Time cannot be empty" }),
        endtime: z
          .string({ message: "End Time is required" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" })
          .nonempty({ message: "End Time cannot be empty" }),
      });

      let { accountid, vinno, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinno: req.params.vinno,
        starttime: req.query.starttime,
        endtime: req.query.endtime,
      });

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
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["tripinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle trip analytics."
        );
      }

      let result =
        await this.tripsinsightssvcHdlrImpl.GetActiveVehicleDataByVinLogic(
          accountid,
          vinno,
          startepoch,
          endepoch
        );
      if (result instanceof Error) {
        result = [];
      }
      APIResponseOK(
        req,
        res,
        result,
        "Active vehicle data listed successfully"
      );
    } catch (error) {
      this.logger.error("GetActiveVehicleDataByVin error: ", error);
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
          "FAILED_TO_GET_ACTIVE_VEHICLE_DATA",
          {},
          "Failed to get active vehicle data"
        );
      }
    }
  };

  GetFleetUtilizationHeatMap = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
        starttime: z
          .string({ message: "Start Time is required" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" })
          .nonempty({ message: "Start Time cannot be empty" }),
        endtime: z
          .string({ message: "End Time is required" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" })
          .nonempty({ message: "End Time cannot be empty" }),
      });

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let { accountid, fleetid, starttime, endtime } = validateAllInputs(
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

      if (!CheckUserPerms(userPerms, ["tripinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet trip analytics."
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

      result = await this.tripsinsightssvcHdlrImpl.GetFleetUtilizationLogic(
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
            900
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
      APIResponseOK(req, res, result, "Fleet utilization listed successfully");
    } catch (error) {
      this.logger.error("GetFleetUtilizationHeatMap error: ", error);
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
          "FAILED_TO_GET_FLEET_UTILIZATION",
          {},
          "Failed to get fleet utilization"
        );
      }
    }
  };

  GetFleetUtilizationHeatMapForVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN number format" })
          .nonempty({ message: "VIN number cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN NO must be at most 128 characters long" }),
        starttime: z
          .string({ message: "Start Time is required" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" })
          .nonempty({ message: "Start Time cannot be empty" }),
        endtime: z
          .string({ message: "End Time is required" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" })
          .nonempty({ message: "End Time cannot be empty" }),
      });

      let { accountid, vinno, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinno: req.params.vinno,
        starttime: req.query.starttime,
        endtime: req.query.endtime,
      });

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
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["tripinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle trip analytics."
        );
      }

      let result =
        await this.tripsinsightssvcHdlrImpl.GetFleetUtilizationForVehicleLogic(
          accountid,
          vinno,
          startepoch,
          endepoch
        );
      if (result instanceof Error) {
        result = [];
      }
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle utilization listed successfully"
      );
    } catch (error) {
      this.logger.error("GetFleetUtilizationHeatMapForVehicle error: ", error);
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
          "FAILED_TO_GET_VEHICLE_UTILIZATION",
          {},
          "Failed to get vehicle utilization"
        );
      }
    }
  };

  GetActiveVehiclesByFleet = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        starttime: z
          .string({ message: "Start Time is required" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" })
          .nonempty({ message: "Start Time cannot be empty" }),
        endtime: z
          .string({ message: "End Time is required" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" })
          .nonempty({ message: "End Time cannot be empty" }),
      });

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let { accountid, fleetid, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          starttime: req.query.starttime,
          endtime: req.query.endtime,
        }
      );

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

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["tripinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet trip analytics."
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

      result =
        await this.tripsinsightssvcHdlrImpl.GetActiveVehiclesByFleetLogic(
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
            900
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
      APIResponseOK(req, res, result, "Active vehicles listed successfully");
    } catch (error) {
      this.logger.error("GetActiveVehiclesByFleet error: ", error);
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
          "FAILED_TO_GET_ACTIVE_VEHICLES",
          {},
          "Failed to get active vehicles"
        );
      }
    }
  };

  GetFleetDrivingMode = async (req, res, next) => {
    try {
      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Account ID must be a valid UUID" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Fleet ID must be a valid UUID" }),
        starttime: z
          .string({ message: "Start Time is required" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" })
          .nonempty({ message: "Start Time cannot be empty" }),
        endtime: z
          .string({ message: "End Time is required" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" })
          .nonempty({ message: "End Time cannot be empty" }),
      });

      let { accountid, fleetid, starttime, endtime } = validateAllInputs(
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

      result = await this.tripsinsightssvcHdlrImpl.GetFleetDrivingModeLogic(
        accountid,
        fleetid,
        startepoch,
        endepoch,
        recursive
      );
      if (result instanceof Error) {
        result = {
          activeVehicles: {},
          drivingModeUsage: {},
          rangeComparison: {},
        };
      }
      if (result && Object.keys(result).length > 0) {
        try {
          const [setResult, setError] = await redisSvc.set(
            redisKey,
            JSON.stringify(result),
            900
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
      APIResponseOK(
        req,
        res,
        result,
        "Fleet driving mode data listed successfully"
      );
    } catch (error) {
      this.logger.error("GetFleetDrivingMode error: ", error);
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
          "FAILED_TO_GET_FLEET_DRIVING_MODE",
          {},
          "Failed to get fleet driving mode data"
        );
      }
    }
  };

  GetVehicleDrivingMode = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        vinno: z
          .string({ message: "VIN number is required" })
          .nonempty({ message: "VIN number cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN number must be at most 128 characters" }),

        starttime: z
          .string({ message: "Start time is required" })
          .regex(/^\d+$/, { message: "Start time must contain only numbers" })
          .nonempty({ message: "Start time cannot be empty" }),

        endtime: z
          .string({ message: "End time is required" })
          .regex(/^\d+$/, { message: "End time must contain only numbers" })
          .nonempty({ message: "End time cannot be empty" }),
      });

      let { accountid, vinno, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinno: req.params.vinno,
        starttime: req.query.starttime,
        endtime: req.query.endtime,
      });

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

      let result =
        await this.tripsinsightssvcHdlrImpl.GetVehicleDrivingModeLogic(
          accountid,
          vinno,
          startepoch,
          endepoch
        );
      if (result instanceof Error) {
        result = {
          activeVehicles: {},
          drivingModeUsage: {},
          rangeComparison: {},
        };
      }
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle driving mode data listed successfully"
      );
    } catch (error) {
      this.logger.error("GetVehicleDrivingMode error: ", error);
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
          "FAILED_TO_GET_VEHICLE_DRIVING_MODE",
          {},
          "Failed to get vehicle driving mode data"
        );
      }
    }
  };

  GetVehicleTripReport = async (req, res, next) => {
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
      });

      const { accountid, vinnumbers, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          vinnumbers: req.body.vinnumbers,
          starttime: req.body.starttime,
          endtime: req.body.endtime,
        }
      );

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

      if (!CheckUserPerms(userPerms, ["tripinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get trip insights."
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

      result = await this.tripsinsightssvcHdlrImpl.GetVehicleTripReportLogic(
        vinnumbers,
        starttime,
        endtime
      );

      if (result instanceof Error) {
        result = [];
      }

      if (result && Object.keys(result).length > 0) {
        try {
          const [setResult, setError] = await redisSvc.set(
            redisKey,
            JSON.stringify(result),
            900
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
      this.logger.error("GetVehicleTripReport error: ", error);
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
          "FAILED_TO_GET_VEHICLE_TRIP_REPORT",
          {},
          "Failed to get vehicle trip report"
        );
      }
    }
  };

  GetFleetTripReport = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" })
          .optional(),
        starttime: z
          .string({ message: "Start Time is invalid" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" }),
        endtime: z
          .string({ message: "End Time is invalid" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" }),
      });

      const recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

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

      if (!CheckUserPerms(userPerms, ["tripinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get trip insights."
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
      result = await this.tripsinsightssvcHdlrImpl.GetFleetTripReportLogic(
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
            900
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
      this.logger.error("GetFleetTripReport error: ", error);
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
          "FAILED_TO_GET_FLEET_TRIP_REPORT",
          {},
          "Failed to get fleet trip report"
        );
      }
    }
  };

  GetFleetOverview = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        starttime: z
          .string({ message: "Start Time is invalid" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" }),
        endtime: z
          .string({ message: "End Time is invalid" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" }),
      });

      const { accountid, fleetid, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          starttime: req.query.starttime,
          endtime: req.query.endtime,
        }
      );

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

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

      if (!CheckUserPerms(userPerms, ["tripinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get trip insights overview."
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

      result = await this.tripsinsightssvcHdlrImpl.GetFleetOverviewLogic(
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
            900
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

      APIResponseOK(
        req,
        res,
        result,
        "Tripinsights overview retrieved successfully"
      );
    } catch (error) {
      this.logger.error("GetFleetOverview error: ", error);
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
          "FAILED_TO_GET_TRIPINSIGHTS_OVERVIEW",
          {},
          "Failed to get tripinsights overview"
        );
      }
    }
  };

  GetFleetOverviewList = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        starttime: z.string({ message: "Start Time is invalid" }),
        endtime: z.string({ message: "End Time is invalid" }),
        category: z.string({ message: "Category is invalid" }),
      });

      const recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      const { accountid, fleetid, starttime, endtime, category } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          fleetid: req.params.fleetid,
          starttime: req.query.starttime,
          endtime: req.query.endtime,
          category: req.query.category,
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
        accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["tripinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet trip insights overview."
        );
      }

      let result;
      const fullUrl = req.protocol + "://" + req.get("host") + req.originalUrl;
      const redisKey = `${fullUrl}.${starttime}.${endtime}.${category}`;
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
        await this.tripsinsightssvcHdlrImpl.GetFleetOverviewListLogic(
          accountid,
          fleetid,
          startepoch,
          endepoch,
          category,
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
            900
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

      APIResponseOK(
        req,
        res,
        result,
        "trip insights overview list retrieved successfully"
      );
    } catch (error) {
      this.logger.error("GetFleetTripInsightsOverviewList error: ", error);
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
          "FAILED_TO_GET_FLEET_TRIP_INSIGHTS_OVERVIEW_LIST",
          {},
          "Failed to get fleet trip insights overview list"
        );
      }
    }
  };

  GetFleetDistanceReport = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        starttime: z
          .string({ message: "Start Time is invalid" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" }),
        endtime: z
          .string({ message: "End Time is invalid" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" }),
      });

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

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

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

      if (!CheckUserPerms(userPerms, ["tripinsights.reports.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet trip reports."
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

      result = await this.tripsinsightssvcHdlrImpl.GetFleetDistanceReportLogic(
        accountid,
        fleetid,
        startepoch,
        endepoch,
        recursive
      );

      if (result instanceof Error) {
        result = {
          totalvehicles: 0,
          totaltrips: 0,
          daterange: {},
          dailydata: {},
        };
      }

      if (result && Object.keys(result).length > 0) {
        try {
          const [setResult, setError] = await redisSvc.set(
            redisKey,
            JSON.stringify(result),
            900
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

      APIResponseOK(
        req,
        res,
        result,
        "Fleet distance report retrieved successfully"
      );
    } catch (error) {
      this.logger.error("GetFleetDistanceReport error: ", error);
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
          "FAILED_TO_GET_FLEET_DISTANCE_REPORT",
          {},
          "Failed to get fleet distance report"
        );
      }
    }
  };

  GetVehicleDistanceReport = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN number format" })
          .nonempty({ message: "VIN number cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN NO must be at most 128 characters long" }),
        starttime: z
          .string({ message: "Start Time is invalid" })
          .regex(/^\d+$/, { message: "Start Time must contain only numbers" }),
        endtime: z
          .string({ message: "End Time is invalid" })
          .regex(/^\d+$/, { message: "End Time must contain only numbers" }),
      });

      const { accountid, vinno, starttime, endtime } = validateAllInputs(
        schema,
        {
          accountid: req.accountid,
          vinno: req.params.vinno,
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
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["tripinsights.reports.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle trip reports."
        );
      }

      let result =
        await this.tripsinsightssvcHdlrImpl.GetVehicleDistanceReportLogic(
          accountid,
          vinno,
          startepoch,
          endepoch
        );

      if (result instanceof Error) {
        result = {
          totalvehicles: 0,
          totaltrips: 0,
          daterange: {},
          dailydata: {},
        };
      }

      APIResponseOK(
        req,
        res,
        result,
        "Vehicle distance report retrieved successfully"
      );
    } catch (error) {
      this.logger.error("GetVehicleDistanceReport error: ", error);
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
          "FAILED_TO_GET_VEHICLE_DISTANCE_REPORT",
          {},
          "Failed to get vehicle distance report"
        );
      }
    }
  };
}
