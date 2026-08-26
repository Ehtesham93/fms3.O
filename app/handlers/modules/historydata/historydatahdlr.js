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
import HistoryDataHdlrImpl from "./historydatahdlr_impl.js";
export default class HistoryDataHdlr {
  constructor(historyDataSvcI, fmsAccountSvcI, logger, config) {
    this.historyDataHdlrImpl = new HistoryDataHdlrImpl(historyDataSvcI, logger);
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.logger = logger;
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
  // TODO: add request validation for each route
  RegisterRoutes(router) {
    const accountTokenGroup = promiserouter();
    accountTokenGroup.use(AuthenticateAccountTokenFromCookie);
    accountTokenGroup.use(this.VerifyUserAccountAccess);
    if (this.config?.fmsFeatures?.enableCreditChecks) {
      accountTokenGroup.use(this.CheckEnoughCredits);
    }

    router.use("/", accountTokenGroup);

    accountTokenGroup.post("/vehicle/:vinno/gps", this.GetGPSHistoryData);
    accountTokenGroup.post("/vehicle/:vinno/can", this.GetCANHistoryData);

    accountTokenGroup.post(
      "/vehicle/:vinno/cangps",
      this.GetMergedCANGPSHistoryData
    );

    accountTokenGroup.post("/vehicle/latestdata", this.GetVehicleLatestData);
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

  GetGPSHistoryData = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .nonempty({ message: "VIN No is required" })
          .max(128, { message: "VIN No must be at most 128 characters long" }),
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
          "Start time must be less than end time"
        );
        return;
      }

      if (endtime - starttime > 31 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 31 days"
        );
        return;
      }

      let result = await this.historyDataHdlrImpl.GetGPSHistoryDataLogic(
        accountid,
        vinno,
        starttime,
        endtime
      );

      APIResponseOK(req, res, result, "GPS history data listed successfully");
    } catch (error) {
      this.logger.error("GetGPSHistoryData error: ", error);
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
          "FAILED_TO_GET_GPS_HISTORY_DATA",
          {},
          "Failed to get GPS history data"
        );
      }
    }
  };

  GetCANHistoryData = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Acccount ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .nonempty({ message: "Invalid VIN No format" })
          .max(128, { message: "Vin No must be at most 128 characters long" }),
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
        canparams: z
          .array(
            z
              .string({ message: "Invalid CAN param format" })
              .min(1, { message: "CAN param cannot be empty" })
              .max(128, {
                message: "CAN param must be at most 128 characters long",
              })
          )
          .min(1, { message: "At least one CAN param is required" })
          .optional(),
      });

      const { accountid, vinno, starttime, endtime, canparams } =
        validateAllInputs(schema, {
          accountid: req.accountid,
          vinno: req.params.vinno,
          starttime: req.body.starttime,
          endtime: req.body.endtime,
          canparams: req.body.canparams,
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

      if (endtime - starttime > 31 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 31 days"
        );
        return;
      }

      let result = await this.historyDataHdlrImpl.GetCANHistoryDataLogic(
        accountid,
        vinno,
        starttime,
        endtime,
        canparams
      );
      APIResponseOK(req, res, result, "CAN history data listed successfully");
    } catch (error) {
      this.logger.error("GetCANHistoryData error: ", error);
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
          "FAILED_TO_GET_CAN_HISTORY_DATA",
          {},
          "Failed to get CAN history data"
        );
      }
    }
  };

  GetMergedCANGPSHistoryData = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .nonempty({ message: "VIN No is required" })
          .max(128, { message: "VIN No must be at most 128 characters long" }),
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
        canparams: z
          .array(
            z
              .string({ message: "Each CAN param must be a string" })
              .min(1, { message: "CAN param cannot be empty" })
              .max(128, {
                message: "CAN param must be at most 128 characters long",
              })
          )
          .min(1, { message: "At least one CAN param is required" })
          .optional(),
      });

      const { accountid, vinno, starttime, endtime, canparams } =
        validateAllInputs(schema, {
          accountid: req.accountid,
          vinno: req.params.vinno,
          starttime: req.body.starttime,
          endtime: req.body.endtime,
          canparams: req.body.canparams,
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

      if (endtime - starttime > 31 * 24 * 60 * 60 * 1000) {
        APIResponseBadRequest(
          req,
          res,
          "TIME_RANGE_TOO_LARGE",
          {},
          "Time range is too large selected range should be <= 31 days"
        );
        return;
      }

      let result =
        await this.historyDataHdlrImpl.GetMergedCANGPSHistoryDataLogic(
          accountid,
          vinno,
          starttime,
          endtime,
          canparams
        );

        if (result instanceof Error) {
          APIResponseBadRequest(
            req,
            res,
            "INVALID_CAN_PARAMS",
            {},
            result.message
          );
          return;
        }

      APIResponseOK(
        req,
        res,
        result,
        "Merged CAN+GPS history data listed successfully"
      );
    } catch (error) {
      this.logger.error("GetMergedCANGPSHistoryData error: ", error);
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
          "FAILED_TO_GET_MERGED_CANGPS_HISTORY_DATA",
          {},
          "Failed to get merged CAN+GPS history data"
        );
      }
    }
  };

  GetVehicleLatestData = async (req, res, next) => {
    try {
      let schema = z.object({
        vinnos: z
          .array(
            z
              .string({ message: "VIN No must be a string" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message:
                  "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
              })
              .min(1, { message: "VIN No cannot be empty" })
              .max(128, {
                message: "VIN No must be at most 128 characters long",
              })
          )
          .min(1, { message: "VINs array must contain at least one VIN" }),
      });
      let { vinnos } = validateAllInputs(schema, {
        vinnos: req.body.vinnos,
      });

      if (!vinnos || vinnos.length === 0 || !Array.isArray(vinnos)) {
        APIResponseBadRequest(
          req,
          res,
          "VIN_REQUIRED",
          "VINs are required to get latest data"
        );
        return;
      }
      let result = await this.historyDataHdlrImpl.GetVehicleLatestDataLogic(
        vinnos
      );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle latest data fetched successfully"
      );
    } catch (error) {
      this.logger.error("GetVehicleLatestData error: ", error);
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
          "FAILED_TO_GET_VEHICLE_LATEST_DATA",
          {},
          "Failed to get vehicle latest data"
        );
      }
    }
  };
}
