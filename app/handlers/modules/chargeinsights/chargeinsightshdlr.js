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
import ChargeinsightshdlrImpl from "./chargeinsightshdlr_impl.js";
export default class Chargeinsightshdlr {
  constructor(
    chargeinsightssvcI,
    fmsAccountSvcI,
    tripsinsightssvcI,
    userSvcI,
    logger,
    redisSvc,
    config
  ) {
    this.chargeinsightssvcI = chargeinsightssvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.logger = logger;
    this.chargeinsightssvcHdlrImpl = new ChargeinsightshdlrImpl(
      chargeinsightssvcI,
      fmsAccountSvcI,
      tripsinsightssvcI,
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

    accountTokenGroup.post(
      "/vehicle/:vinno/chargeinsights",
      this.GetChargeInsightsByVehicle
    );
    accountTokenGroup.post(
      "/fleet/:fleetid/chargeinsights",
      this.ValidateFleetAccess,
      this.GetChargeInsightsByFleet
    );
    accountTokenGroup.get(
      "/vehicle/:vinno/chargedistribution",
      this.GetChargeDistributionByVehicle
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/chargedistribution",
      this.ValidateFleetAccess,
      this.GetChargeDistributionByFleet
    );

    accountTokenGroup.post(
      "/vehicle/vehiclechargeinsights",
      this.GetVehicleChargeInsights
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/fleetchargeinsights",
      this.ValidateFleetAccess,
      this.GetFleetChargeInsights
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/chargeinsightsoverview",
      this.ValidateFleetAccess,
      this.GetFleetChargeInsightsOverview
    );
    accountTokenGroup.get(
      "/fleet/:fleetid/chargeinsightsoverview/list",
      this.ValidateFleetAccess,
      this.GetFleetChargeInsightsOverviewList
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
        error.errcode || "USER_DOES_NOT_HAVE_ACCESS",
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

  GetChargeInsightsByVehicle = async (req, res, next) => {
    try {
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .nonempty({ message: "Invalid VIN format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "Vin NO must be at most 128 characters long" }),
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

      let { accountid, vinno, starttime, endtime } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinno: req.params.vinno,
        starttime: req.body.starttime,
        endtime: req.body.endtime,
      });

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["chargeinsights.reports.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle charge reports."
        );
      }

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
        await this.chargeinsightssvcHdlrImpl.GetChargeInsightsByVehicleLogic(
          accountid,
          vinno,
          starttime,
          endtime
        );
      if (result instanceof Error) {
        result = [];
      }
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle charge insights listed successfully"
      );
    } catch (error) {
      this.logger.error("GetChargeInsightsByVehicle error: ", error);
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
          error.errcode || "FAILED_TO_GET_VEHICLE_CHARGE_INSIGHTS",
          {},
          "Failed to get vehicle charge insights"
        );
      }
    }
  };

  GetChargeInsightsByFleet = async (req, res, next) => {
    try {
      let schema = z.object({
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

      let recursive = req.query.recursive
        ? req.query.recursive === "true"
        : false;

      let { accountid, fleetid, starttime, endtime } = validateAllInputs(
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
          "Start time must be less than end time"
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

      if (!CheckUserPerms(userPerms, ["chargeinsights.reports.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet charge reports."
        );
      }

      let result;
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
        await this.chargeinsightssvcHdlrImpl.GetChargeInsightsByFleetLogic(
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

      APIResponseOK(
        req,
        res,
        result,
        "Fleet charge insights listed successfully"
      );
    } catch (error) {
      this.logger.error("GetChargeInsightsByFleet error: ", error);
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
          error.errcode || "FAILED_TO_GET_FLEET_CHARGE_INSIGHTS",
          {},
          "Failed to get fleet charge insights"
        );
      }
    }
  };

  GetChargeDistributionByVehicle = async (req, res, next) => {
    try {
      let timestamp = req.query.timestamp;
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Account ID must be a valid UUID" }),

        vinno: z
          .string({ message: "Invalid VIN number format" })
          .nonempty({ message: "VIN number is required" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "VIN number must be at most 128 characters" }),
      });

      let { accountid, vinno } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinno: req.params.vinno,
      });
      if (!timestamp) {
        APIResponseBadRequest(
          req,
          res,
          "MISSING_PARAMETERS",
          {},
          "timestamp is required"
        );
        return;
      }

      if (isNaN(Number(timestamp)) || !Number.isInteger(Number(timestamp))) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIMESTAMP",
          {},
          "timestamp must be a valid integer"
        );
        return;
      }

      const timestampepoch = this.ValidateEpochTime(timestamp, "timestamp");

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["chargeinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle charge analytics."
        );
      }

      let distribution =
        await this.chargeinsightssvcHdlrImpl.GetChargeDistributionByVehicleLogic(
          accountid,
          vinno,
          timestampepoch
        );
      APIResponseOK(req, res, distribution);
    } catch (error) {
      this.logger.error("GetChargeDistributionByVehicle error: ", error);
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
          "FAILED_TO_GET_CHARGE_DISTRIBUTION_BY_VEHICLE",
          {},
          "Failed to get charge distribution by vehicle"
        );
      }
    }
  };

  GetChargeDistributionByFleet = async (req, res, next) => {
    try {
      let timestamp = req.query.timestamp;
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
      });

      let { accountid, fleetid } = validateAllInputs(schema, {
        accountid: req.accountid,
        fleetid: req.params.fleetid,
      });
      if (!timestamp) {
        APIResponseBadRequest(
          req,
          res,
          "MISSING_PARAMETERS",
          {},
          "timestamp is required"
        );
        return;
      }

      if (isNaN(Number(timestamp)) || !Number.isInteger(Number(timestamp))) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_TIMESTAMP",
          {},
          "timestamp must be a valid integer"
        );
        return;
      }

      const timestampepoch = this.ValidateEpochTime(timestamp, "timestamp");
      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["chargeinsights.analytics.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet charge analytics."
        );
      }

      let distribution =
        await this.chargeinsightssvcHdlrImpl.GetChargeDistributionByFleetLogic(
          accountid,
          fleetid,
          timestampepoch,
          recursive
        );
      APIResponseOK(req, res, distribution);
    } catch (error) {
      this.logger.error("GetChargeDistributionByFleet error: ", error);
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
          "FAILED_TO_GET_CHARGE_DISTRIBUTION_BY_FLEET",
          {},
          "Failed to get charge distribution by fleet"
        );
      }
    }
  };

  GetVehicleChargeInsights = async (req, res, next) => {
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

      if (!CheckUserPerms(userPerms, ["chargeinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get charge insights."
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

      result =
        await this.chargeinsightssvcHdlrImpl.GetVehicleChargeInsightsLogic(
          accountid,
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
      this.logger.error("GetVehicleChargeInsights error: ", error);
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
          error.errcode || "FAILED_TO_GET_VEHICLE_CHARGE_INSIGHTS",
          {},
          "Failed to get vehicle trips"
        );
      }
    }
  };

  GetFleetChargeInsights = async (req, res, next) => {
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

      if (!CheckUserPerms(userPerms, ["chargeinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get charge insights."
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

      result = await this.chargeinsightssvcHdlrImpl.GetFleetChargeInsightsLogic(
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
      this.logger.error("GetFleetChargeInsights error: ", error);
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
          "FAILED_TO_GET_FLEET_CHARGE_INSIGHTS",
          {},
          "Failed to get fleet charge insights"
        );
      }
    }
  };

  GetFleetChargeInsightsOverview = async (req, res, next) => {
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

      if (!CheckUserPerms(userPerms, ["chargeinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet charge insights overview."
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
        await this.chargeinsightssvcHdlrImpl.GetFleetChargeInsightsOverviewLogic(
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

      APIResponseOK(
        req,
        res,
        result,
        "charge insights overview retrieved successfully"
      );
    } catch (error) {
      this.logger.error("GetFleetChargeInsightsOverview error: ", error);
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
          "FAILED_TO_GET_FLEET_CHARGE_INSIGHTS_OVERVIEW",
          {},
          "Failed to get fleet charge insights overview"
        );
      }
    }
  };

  GetFleetChargeInsightsOverviewList = async (req, res, next) => {
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

      if (!CheckUserPerms(userPerms, ["chargeinsights.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get fleet charge insights overview."
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
        await this.chargeinsightssvcHdlrImpl.GetFleetChargeInsightsOverviewListLogic(
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

      APIResponseOK(
        req,
        res,
        result,
        "charge insights overview list retrieved successfully"
      );
    } catch (error) {
      this.logger.error("GetFleetChargeInsightsOverviewList error: ", error);
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
          "FAILED_TO_GET_FLEET_CHARGE_INSIGHTS_OVERVIEW_LIST",
          {},
          "Failed to get fleet charge insights overview list"
        );
      }
    }
  };
}
