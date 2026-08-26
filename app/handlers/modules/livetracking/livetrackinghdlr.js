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
import LivetrackinghdlrImpl from "./livetrackinghdlr_impl.js";
import { getLoggableRequest } from "../../../utils/commonutil.js";
import {
  GEOCODE_DEFAULT_LOCALE,
  GEOCODE_ALLOWED_LOCALES,
} from "../../../utils/constant.js";
export default class Livetrackinghdlr {
  constructor(
    livetrackingsvcI,
    fmsAccountSvcI,
    userSvcI,
    geocodeSvcI,
    redisSvcI,
    platformSvcI,
    logger,
    config
  ) {
    this.livetrackingsvcI = livetrackingsvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.geocodeSvcI = geocodeSvcI;
    this.redisSvcI = redisSvcI;
    this.platformSvcI = platformSvcI;
    this.logger = logger;
    this.livetrackingsvcHdlrImpl = new LivetrackinghdlrImpl(
      livetrackingsvcI,
      geocodeSvcI,
      redisSvcI,
      platformSvcI,
      logger,
      config
    );
    this.permissionSvc = new PermissionSvc(fmsAccountSvcI, userSvcI, logger);
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

    accountTokenGroup.get("/vehicles", this.GetVehicles);
    accountTokenGroup.get("/vehicleinfo", this.GetVehicleInfo);

    accountTokenGroup.get("/reversegeocode", this.GetReverseGeocode);
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

  GetVehicles = async (req, res, next) => {
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
        fleetid: req.query.fleetid,
      });

      let recursiveBool = req.query.recursive === "true";

      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid,
        fleetid
      );

      if (!CheckUserPerms(userPerms, ["livetracking.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission for live tracking overview."
        );
      }

      let result = await this.livetrackingsvcHdlrImpl.GetVehiclesLogic(
        accountid,
        fleetid,
        recursiveBool
      );

      APIResponseOK(req, res, result, "Vehicles fetched successfully");
    } catch (error) {
      this.logger.error("GetVehicles error: ", error);
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
          "FAILED_TO_GET_VEHICLES",
          {},
          "Failed to get vehicles"
        );
      }
    }
  };

  GetVehicleInfo = async (req, res, next) => {
    try {
      const schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "Invalid VIN format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message:
              "VIN must contain only letters, numbers, and spaces, and must not start or end with a space",
          })
          .max(128, { message: "Vin No must be at most 128 characters long" }),
      });

      const { accountid, vinno } = validateAllInputs(schema, {
        accountid: req.accountid,
        vinno: req.query.vinno,
      });
      if (!vinno) {
        APIResponseBadRequest(req, res, "VINNO_REQUIRED", "VINNO is required");
        return next(new Error("VINNO is required"));
      }
      const userPerms = await this.permissionSvc.GetUserFleetPermissions(
        req.userid,
        req.accountid
      );

      if (!CheckUserPerms(userPerms, ["livetracking.overview.view"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission for live tracking overview."
        );
      }
      let result = await this.livetrackingsvcHdlrImpl.GetVehicleInfoLogic(
        accountid,
        vinno
      );
      APIResponseOK(req, res, result, "Vehicle info fetched successfully");
    } catch (error) {
      this.logger.error("GetVehicleInfo error: ", error);
      if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message
        );
      } else if (error.message === "VEHICLE_DOES_NOT_EXIST_IN_ACCOUNT") {
        APIResponseBadRequest(
          req,
          res,
          error.message,
          {},
          "Vehicle does not exist in account"
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
          "FAILED_TO_GET_VEHICLE_INFO",
          {},
          "Failed to get vehicle info"
        );
      }
    }
  };

  GetReverseGeocode = async (req, res, next) => {
    try {
      let reqLog = getLoggableRequest(req);
      const schema = z.object({
        latitude: z.string({ message: "Invalid Latitude format" }),
        longitude: z.string({ message: "Invalid Longitude format" }),
        locale: z.string({ message: "Invalid Locale format" }).optional(),
      });
      const { latitude, longitude, locale } = validateAllInputs(schema, {
        latitude: req.query.lat,
        longitude: req.query.lng,
        locale: req.query.locale || GEOCODE_DEFAULT_LOCALE,
      });

      let latFloat = parseFloat(latitude);
      let lngFloat = parseFloat(longitude);

      if (isNaN(latFloat) || isNaN(lngFloat)) {
        throw {
          errcode: "INPUT_ERROR",
          errdata: {
            latitude: latitude,
            longitude: longitude,
          },
          message: "Invalid latitude or longitude format",
        };
      }

      const version = req.headers["x-version"] || "";
      const lastPart = version.split("_").pop();
      const buildNumber = Number(lastPart);
      if (req.headers["x-platform"] === "Nemo3-Android" && buildNumber < 51 ){
        let result = `${latFloat.toString()},${lngFloat.toString()}`;
        APIResponseOK(req, res, result, "Geocode fetched successfully");
      }

      if (!GEOCODE_ALLOWED_LOCALES.includes(locale)) {
        this.logger.warn("Invalid locale format, using default locale: ", {
          locale: locale,
        });
        locale = GEOCODE_DEFAULT_LOCALE;
      }

      let result = await this.livetrackingsvcHdlrImpl.GetReverseGeocodeLogic(
        latFloat,
        lngFloat,
        locale
      );
      APIResponseOK(req, res, result, "Geocode fetched successfully");
    } catch (error) {
      this.logger.error("GetGeocode error: ", error);
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
          "FAILED_TO_GET_GEOCODE",
          {},
          "Failed to get geocode"
        );
      }
    }
  };
}
