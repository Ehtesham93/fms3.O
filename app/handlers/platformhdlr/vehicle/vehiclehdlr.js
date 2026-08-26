import { z } from "zod";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import VehicleHdlrImpl from "./vehiclehdlr_impl.js";
import { parseQueryInt } from "../../../utils/commonutil.js";

export default class VehicleHdlr {
  constructor(
    platformSvcI,
    historyDataSvcI,
    fmsAccountSvcI,
    metaSvcI,
    redisSvc,
    logger
  ) {
    this.platformSvcI = platformSvcI;
    this.historyDataSvcI = historyDataSvcI;
    this.metaSvcI = metaSvcI;
    this.redisSvc = redisSvc;
    this.vehicleHdlrImpl = new VehicleHdlrImpl(
      platformSvcI,
      historyDataSvcI,
      metaSvcI,
      fmsAccountSvcI,
      redisSvc,
      logger
    );
    this.logger = logger;
  }

  RegisterRoutes(router) {
    router.post("/create", this.CreateVehicle);
    router.put("/:vinno/info", this.UpdateVehicleInfo);
    router.delete("/:vinno/delete", this.DeleteVehicle);
    router.get("/list", this.ListVehicles);
    router.get("/listall", this.ListAllVehicles);
    router.get("/", this.GetVehicles);
    router.get("/:vinno/info", this.GetVehicleInfo);
    router.get("/:vinno/accountinfo", this.GetVehicleAccountDetails);

    // vehicle-account
    router.post("/add", this.AddVehicleToCustomFleet);

    // vehicle-history
    router.get("/:vinno/getlatestdata", this.GetVehicleLatestData);
    router.post("/:vinno/getcangpsdata", this.GetVehicleCANGPSData);
    router.get("/history", this.GetVehicleHistory);

    // tag vehicles
    router.post("/tagvehicle", this.TagVehicle);
    router.put("/untagvehicle", this.UntagVehicle);

    // dms-vehicle onboarding
    router.post("/onboardvehicle", this.OnboardVehicle);
    router.post("/reviewvehicleonboard", this.ReviewVehicleOnboard);
    router.get("/listpending", this.ListPendingVehicles);
    router.get("/listdone", this.ListDoneVehicles);
    router.post("/vehicleserviceonboarding", this.VehicleServiceOnboarding);
    router.get("/:vinno/serviceonboarding/history", this.VehicleServiceOnboardingHistory);
    router.get("/:vinno/serviceonboarding/status", this.VehicleServiceOnboardingStatus);
    router.post("/retryonboard", this.RetryOnboard);
    router.post("/search", this.SearchVehicles);
    router.post("/lastconnected", this.VehicleLastConnected);
  }

  ValidateEpochTime = (timeStr, fieldName) => {
    if (!/^\d+$/.test(timeStr)) {
      throw {
        errcode: "INPUT_ERROR",
        message: `${fieldName} must be a valid epoch time (integer)`,
      };
    }

    const epochTime = parseInt(timeStr, 10);

    if (epochTime < 0 || epochTime > 4102444800000) {
      throw {
        errcode: "INPUT_ERROR",
        message: `${fieldName} must be a valid epoch time`,
      };
    }

    return epochTime;
  };

  CreateVehicle = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create vehicle."
        );
      }
      let schema = z.object({
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .length(17, { message: "VIN must be exactly 17 characters" })
          .regex(/^M[AB][A-HJ-NPR-Z0-9]{15}$/, {
            message: "Please enter a valid Indian VIN number starting with MA",
          }),
        modelcode: z
          .string({ message: "Invalid Model Code format" })
          .nonempty({ message: "Model Code cannot be empty" })
          .max(128, { message: "Model Code must not exceed 128 characters" }),

        vehicleinfo: z
          .record(z.any(), { message: "Vehicle Info must be an object" })
          .default({}),

        mobileno: z
          .string({ message: "Invalid Mobile Number format" })
          .optional()
          .nullable(),
      });
      let createdby = req.userid;

      let { vinno, modelcode, vehicleinfo, mobileno } = validateAllInputs(
        schema,
        {
          vinno: req.body.vinno,
          modelcode: req.body.modelcode,
          vehicleinfo: req.body.vehicleinfo,
          mobileno: req.body.mobileno,
        }
      );

      let result = await this.vehicleHdlrImpl.CreateVehicleLogic(
        vinno,
        modelcode,
        vehicleinfo,
        mobileno,
        createdby
      );

      APIResponseOK(req, res, result, "Vehicle created successfully");
    } catch (e) {
      this.logger.error("CreateVehicle error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.message.includes("Vehicle already exists")) {
        APIResponseBadRequest(
          req,
          res,
          "VEHICLE_ALREADY_EXISTS",
          null,
          "Vehicle already exists"
        );
      } else if (e.message.includes("Model not found")) {
        APIResponseBadRequest(
          req,
          res,
          "MODEL_NOT_FOUND",
          null,
          "Model not found"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_VEHICLE_ERR",
          e.toString(),
          "Create vehicle failed"
        );
      }
    }
  };

  UpdateVehicleInfo = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update vehicle info."
        );
      }
      let vinno = req.params.vinno;
      let updatedby = req.userid;

      const { vinno: bodyVinno, ...updateFields } = req.body;

      if (!updateFields || Object.keys(updateFields).length === 0) {
        APIResponseBadRequest(
          req,
          res,
          "NO_UPDATE_FIELDS",
          "No fields provided for update"
        );
        return;
      }

      let result = await this.vehicleHdlrImpl.UpdateVehicleInfoLogic(
        vinno,
        updateFields,
        updatedby
      );
      APIResponseOK(req, res, result, "Vehicle info updated successfully");
    } catch (e) {
      this.logger.error("UpdateVehicleInfo error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "VALIDATION_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_VEHICLE_INFO_ERR",
          e.toString(),
          "Update vehicle info failed"
        );
      }
    }
  };

  DeleteVehicle = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete vehicle."
        );
      }

      let schema = z.object({
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN must be a valid format",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),
      });

      let { vinno } = validateAllInputs(schema, {
        vinno: req.params.vinno,
      });

      let deletedby = req.userid;

      let result = await this.vehicleHdlrImpl.DeleteVehicleLogic(
        vinno,
        deletedby
      );

      APIResponseOK(req, res, result, "Vehicle deleted successfully");
    } catch (e) {
      this.logger.error("DeleteVehicle error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.message.includes("Vehicle not found")) {
        APIResponseBadRequest(
          req,
          res,
          "VEHICLE_NOT_FOUND",
          null,
          "Vehicle not found"
        );
      } else if (e.message.includes("Vehicle is associated")) {
        APIResponseBadRequest(req, res, "VEHICLE_ASSOCIATED", null, e.message);
      } else if (e.message.includes("historical data")) {
        APIResponseBadRequest(
          req,
          res,
          "VEHICLE_HAS_HISTORICAL_DATA",
          null,
          e.message
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "DELETE_VEHICLE_ERR",
          e.toString(),
          "Delete vehicle failed"
        );
      }
    }
  };

  AddVehicleToCustomFleet = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, ["consolemgmt.accountvehicle.admin"])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to add vehicle to custom fleet."
        );
      }
      let schema = z.object({
        accountid: z
          .string({ message: "Invalid Account ID format" })
          .uuid({ message: "Invalid Account ID format" }),
        fleetid: z
          .string({ message: "Invalid Fleet ID format" })
          .uuid({ message: "Invalid Fleet ID format" }),
        vinno: z
          .string({ message: "Invalid VIN number" })
          .nonempty({ message: "VIN number cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN must be a valid format",
          })
          .max(128, { message: "VIN number must not exceed 128 characters" }),
        assignedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { accountid, fleetid, vinno, assignedby } = validateAllInputs(
        schema,
        {
          ...req.body,
          assignedby: req.userid,
        }
      );

      let result = await this.vehicleHdlrImpl.AddVehicleToCustomFleetLogic(
        accountid,
        fleetid,
        vinno,
        assignedby
      );

      APIResponseOK(
        req,
        res,
        result,
        "Vehicle added to custom fleet successfully"
      );
    } catch (e) {
      this.logger.error("AddVehicleToCustomFleet error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.message.includes("Vehicle not found")) {
        APIResponseBadRequest(
          req,
          res,
          "VEHICLE_NOT_FOUND",
          null,
          "Vehicle not found"
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ADD_VEHICLE_TO_CUSTOM_FLEET_ERR",
          e.toString(),
          "Add vehicle to custom fleet failed"
        );
      }
    }
  };

  ListVehicles = async (req, res, next) => {
    try {
      // if (
      //   !CheckUserPerms(req.userperms, [
      //     "consolemgmt.vehicle.admin",
      //     "consolemgmt.vehicle.view",
      //   ])
      // ) {
      //   return APIResponseForbidden(
      //     req,
      //     res,
      //     "INSUFFICIENT_PERMISSIONS",
      //     null,
      //     "You don't have permission to list vehicles."
      //   );
      // }
      let result = await this.vehicleHdlrImpl.ListVehiclesLogic();
      APIResponseOK(req, res, result, "Vehicles listed successfully");
    } catch (e) {
      this.logger.error("ListVehicles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_VEHICLES_ERR",
          e.toString(),
          "List vehicles failed"
        );
      }
    }
  };

  ListAllVehicles = async (req, res, next) => {
    try {
      let result = await this.vehicleHdlrImpl.ListAllVehiclesLogic();
      APIResponseOK(req, res, result, "Vehicles listed successfully");
    } catch (e) {
      this.logger.error("ListAllVehicles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_ALL_VEHICLES_ERR",
          e.toString(),
          "List vehicles failed"
        );
      }
    }
  };

  GetVehicles = async (req, res, next) => {
    try {
      let schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine((val) => !val || val.length === 0 || val.length >= 3, {
            message: "Search text must be at least 3 characters long",
          }),
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
      let result = await this.vehicleHdlrImpl.GetVehiclesLogic(
        searchtext,
        offset,
        limit
      );
      APIResponseOK(req, res, result, "Vehicles listed successfully");
    } catch (e) {
      this.logger.error("GetVehicles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_VEHICLES_ERR",
          e.toString(),
          "Get vehicles failed"
        );
      }
    }
  };

  GetVehicleInfo = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle info."
        );
      }
      let schema = z.object({
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN must be a valid format",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),
      });

      let { vinno } = validateAllInputs(schema, {
        vinno: req.params.vinno,
      });

      let result = await this.vehicleHdlrImpl.GetVehicleInfoLogic(vinno);
      APIResponseOK(req, res, result, "Vehicle info fetched successfully");
    } catch (e) {
      this.logger.error("GetVehicleInfo error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_VEHICLE_INFO_ERR",
          e.toString(),
          "Get vehicle info failed"
        );
      }
    }
  };

  GetVehicleAccountDetails = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle account details."
        );
      }
      let schema = z.object({
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN must be a valid format",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),
      });

      let { vinno } = validateAllInputs(schema, {
        vinno: req.params.vinno,
      });

      let result = await this.vehicleHdlrImpl.GetVehicleAccountDetailsLogic(
        vinno
      );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle account details fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetVehicleAccountDetails error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_VEHICLE_ACCOUNT_DETAILS_ERR",
          e.toString(),
          "Get vehicle account details failed"
        );
      }
    }
  };

  GetVehicleLatestData = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle latest data."
        );
      }
      let schema = z.object({
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN must be a valid format",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),
      });

      let { vinno } = validateAllInputs(schema, {
        vinno: req.params.vinno,
      });

      let result = await this.vehicleHdlrImpl.GetVehicleLatestDataLogic(vinno);
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle latest data fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetVehicleLatestData error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_VEHICLE_LATEST_DATA_ERR",
          e.toString(),
          "Get vehicle latest data failed"
        );
      }
    }
  };

  GetVehicleCANGPSData = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle CAN+GPS data."
        );
      }
      let schema = z.object({
        vinno: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
            message: "VIN must be a valid format",
          })
          .max(128, { message: "VIN must not exceed 128 characters" }),
        starttime: z.number({ message: "Start Time must be a number" }),
        endtime: z.number({ message: "End Time must be a number" }),
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

      let { vinno, starttime, endtime, canparams } = validateAllInputs(schema, {
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
          "starttime must be less than endtime"
        );
        return;
      }

      let result = await this.vehicleHdlrImpl.GetVehicleCANGPSDataLogic(
        vinno,
        starttime,
        endtime,
        canparams
      );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle CAN+GPS data fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetVehicleCANGPSData error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_VEHICLE_CANGPS_DATA_ERR",
          e.toString(),
          "Get vehicle CAN+GPS data failed"
        );
      }
    }
  };

  TagVehicle = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle CAN+GPS data."
        );
      }

      let schema = z.object({
        taggedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        srcaccountid: z
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

      let { taggedby, srcaccountid, dstaccountid, vinnos, allow_retag } =
        validateAllInputs(schema, {
          taggedby: req.userid,
          srcaccountid: req.body.srcaccountid,
          dstaccountid: req.body.dstaccountid,
          vinnos: req.body.vinnos,
          allow_retag: req.body.allow_retag,
        });

      // Validate that source and destination accounts are different
      if (srcaccountid === dstaccountid) {
        return APIResponseBadRequest(
          req,
          res,
          "SAME_ACCOUNT_ERROR",
          null,
          "Source and destination accounts cannot be the same"
        );
      }

      let result = await this.vehicleHdlrImpl.TagVehicleLogic(
        srcaccountid,
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
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.account.admin",
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle CAN+GPS data."
        );
      }

      let schema = z.object({
        untaggedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        srcaccountid: z
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

      let { untaggedby, srcaccountid, dstaccountid, vinnos } =
        validateAllInputs(schema, {
          untaggedby: req.userid,
          srcaccountid: req.body.srcaccountid,
          dstaccountid: req.body.dstaccountid,
          vinnos: req.body.vinnos,
        });

      let result = await this.vehicleHdlrImpl.UntagVehicleLogic(
        srcaccountid,
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

  OnboardVehicle = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create or update vehicle."
        );
      }

      let schema = z.object({
        vin: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .length(17, { message: "VIN must be exactly 17 characters" })
          .regex(/^M[AB][A-HJ-NPR-Z0-9]{15}$/, {
            message:
              "Please enter a valid Indian VIN number starting with MA or MB",
          }),
        vehicleModel: z
          .string({ message: "Invalid Vehicle Model format" })
          .nonempty({ message: "Vehicle Model cannot be empty" })
          .regex(/^[A-Za-z0-9 _.+-]+$/, {
            message: "Please enter a valid Vehicle Model",
          }),
        vehicleVariant: z
          .string({ message: "Invalid Vehicle Variant format" })
          .nonempty({ message: "Vehicle Variant cannot be empty" }),
        tgu_imei_no: z
          .string({ message: "Invalid TGU IMEI Number format" })
          .optional()
          .nullable(),
        mobileNo: z
          .string({ message: "Invalid Mobile Number format" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          })
          .optional()
          .nullable(),

        dealer: z.string().optional().nullable(),
        deliveredDate: z.string().optional().nullable(),
        engineNo: z.string().optional().nullable(),
        fuelType: z.string().optional().nullable(),
        licensePlate: z.string().optional().nullable(),
        retailsSaleDate: z.string().optional().nullable(),
        vehicleCity: z.string().optional().nullable(),
        vehicleColour: z.string().optional().nullable(),
      });

      let createdOrUpdatedBy = req.userid;

      let validatedInput = validateAllInputs(schema, {
        vin: req.body.vin,
        vehicleModel: req.body.vehicleModel,
        vehicleVariant: req.body.vehicleVariant,
        tgu_imei_no: req.body.tgu_imei_no,
        mobileNo: req.body.mobileNo,
        dealer: req.body.dealer,
        deliveredDate: req.body.deliveredDate,
        engineNo: req.body.engineNo,
        fuelType: req.body.fuelType,
        licensePlate: req.body.licensePlate,
        retailsSaleDate: req.body.retailsSaleDate,
        vehicleCity: req.body.vehicleCity,
        vehicleColour: req.body.vehicleColour,
      });

      let result = await this.vehicleHdlrImpl.OnboardVehicleLogic(
        validatedInput,
        "onboarding",
        createdOrUpdatedBy
      );

      APIResponseOK(req, res, result, "Vehicle processed successfully");
    } catch (e) {
      this.logger.error("OnboardVehicle error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "VEHICLE_ALREADY_EXISTS") {
        APIResponseBadRequest(req, res, e.errcode, {}, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ONBOARD_VEHICLE_ERR",
          e.toString(),
          "Onboard vehicle failed"
        );
      }
    }
  };

  ReviewVehicleOnboard = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to review vehicle onboard."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        updatedfields: z
          .object({
            vin: z.string(),
            vehicleModel: z.string(),
            vehicleVariant: z.string(),
            tgu_imei_no: z.string().optional().nullable(),
            mobileNo: z.string().optional().nullable(),
            dealer: z.string().optional(),
            deliveredDate: z.string().optional().nullable(),
            engineNo: z.string().optional().nullable(),
            fuelType: z.string().optional(),
            licensePlate: z.string().optional().nullable(),
            retailsSaleDate: z.string().optional().nullable(),
            vehicleCity: z.string().optional().nullable(),
            vehicleColour: z.string().optional().nullable(),
          })
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
      let { userid, updatedfields } = validateAllInputs(schema, {
        userid: req.userid,
        updatedfields: req.body.updatedfields,
      });

      let result = await this.vehicleHdlrImpl.ReviewVehicleOnboardLogic(
        userid,
        updatedfields
      );
      APIResponseOK(req, res, result, "Vehicle reviewed successfully");
    } catch (e) {
      this.logger.error("ReviewVehicleOnboard error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "VEHICLE_ALREADY_EXISTS") {
        APIResponseBadRequest(req, res, e.errcode, {}, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "ONBOARD_VEHICLE_ERR",
          e.toString(),
          "Onboard vehicle failed"
        );
      }
    }
  };

  ListPendingVehicles = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list pending vehicles."
        );
      }
      let schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine((val) => !val || val.length === 0 || val.length >= 3, {
            message: "Search text must be at least 3 characters long",
          }),
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
      let {
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download,
      } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
        download: parsedownload,
      });
      let result = await this.vehicleHdlrImpl.ListPendingVehiclesLogic(
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download
      );
      APIResponseOK(req, res, result, "Pending vehicles listed successfully");
    } catch (e) {
      this.logger.error("ListPendingVehicles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_PENDING_VEHICLES_ERR",
          e.toString(),
          "List pending vehicles failed"
        );
      }
    }
  };

  ListDoneVehicles = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to list done vehicles."
        );
      }
      let schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .optional()
          .nullable()
          .default("")
          .refine((val) => !val || val.length === 0 || val.length >= 3, {
            message: "Search text must be at least 3 characters long",
          }),
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
          .default("updatedat"),
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
      let {
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download,
      } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
        orderbyfield: req.query.orderbyfield,
        orderbydirection: req.query.orderbydirection,
        download: parsedownload,
      });
      let result = await this.vehicleHdlrImpl.ListDoneVehiclesLogic(
        searchtext,
        offset,
        limit,
        orderbyfield,
        orderbydirection,
        download
      );
      APIResponseOK(req, res, result, "Done vehicles listed successfully");
    } catch (e) {
      this.logger.error("ListDoneVehicles error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_DONE_VEHICLES_ERR",
          e.toString(),
          "List done vehicles failed"
        );
      }
    }
  };

  VehicleServiceOnboarding = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to onboard vehicle service."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        vin: z
          .string({ message: "Invalid VIN format" })
          .nonempty({ message: "VIN cannot be empty" })
          .length(17, { message: "VIN must be exactly 17 characters" })
          .regex(/^M[AB][A-HJ-NPR-Z0-9]{15}$/, {
            message:
              "Please enter a valid Indian VIN number starting with MA or MB",
          }),
        mobileno: z
          .string({ message: "Invalid Mobile Number format" })
          .regex(/^[6-9]\d{9}$/, {
            message:
              "Mobile number must be exactly 10 digits and start with 6 to 9",
          }),
      });
      let { userid, vin, mobileno } = validateAllInputs(schema, {
        userid: req.userid,
        vin: req.body.vin,
        mobileno: req.body.mobileno,
      });
      let result = await this.vehicleHdlrImpl.VehicleServiceOnboardingLogic(
        vin,
        mobileno,
        userid
      );
      APIResponseOK(req, res, result.data, result.msg);
    } catch (e) {
      this.logger.error("VehicleServiceOnboarding error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if(e.errcode === "VEHICLE_ONBOARDING_IN_PROCESS"){
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if(e.errcode === "VEHICLE_ALREADY_ONBOARDED"){
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "VEHICLE_SERVICE_ONBOARDING_ERR",
          e.toString(),
          "Vehicle service onboarding failed"
        );
      }
      return;
    }
  };

  VehicleServiceOnboardingHistory = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to onboard vehicle service."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .nonempty({ message: "VIN No cannot be empty" })
          .length(17, { message: "VIN must be exactly 17 characters" })
          .regex(/^[A-Z0-9]{17}$/, {
            message: "VIN No must be exactly 17 characters and contain only uppercase letters and numbers",
          })
      });
      let { userid, vinno } = validateAllInputs(schema, {
        userid: req.userid,
        vinno: req.params.vinno,
      });
      let result = await this.vehicleHdlrImpl.VehicleServiceOnboardingHistoryLogic(
        vinno,
        userid
      );
      APIResponseOK(req, res, result, "Vehicle service onboarding history fetched successfully");
    } catch (e) {
      this.logger.error("VehicleServiceOnboardingHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "VEHICLE_SERVICE_ONBOARDING_HISTORY_ERR",
          e.toString(),
          "Vehicle service onboarding history failed"
        );
      }
      return;
    }
  };

  VehicleServiceOnboardingStatus = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to onboard vehicle service."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        vinno: z
          .string({ message: "Invalid VIN No format" })
          .nonempty({ message: "VIN No cannot be empty" })
          .length(17, { message: "VIN must be exactly 17 characters" })
          .regex(/^[A-Z0-9]{17}$/, {
            message: "VIN No must be exactly 17 characters and contain only uppercase letters and numbers",
          })
      });
      let { userid, vinno } = validateAllInputs(schema, {
        userid: req.userid,
        vinno: req.params.vinno,
      });
      let result = await this.vehicleHdlrImpl.VehicleServiceOnboardingStatusLogic(
        vinno,
        userid
      );
      APIResponseOK(req, res, result.data, result.msg);
    } catch (e) {
      this.logger.error("VehicleServiceOnboardingStatus error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "VEHICLE_SERVICE_ONBOARDING_STATUS_ERR",
          e.toString(),
          "Vehicle service onboarding status failed"
        );
      }
      return;
    }
  };

  RetryOnboard = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to retry vehicle onboard."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        retrytype: z
          .string({ message: "Invalid Retry Type format" })
          .nonempty({ message: "Retry Type cannot be empty" })
          .refine((val) => ["vehicle"].includes(val), {
            message: "Invalid Retry Type format",
          }),
      });
      let { userid, retrytype } = validateAllInputs(schema, {
        userid: req.userid,
        retrytype: req.body.retrytype,
      });

      let result = await this.vehicleHdlrImpl.RetryOnboardLogic(
        userid,
        retrytype
      );
      APIResponseOK(req, res, result, "Retry onboard successfully");
    } catch (e) {
      this.logger.error("RetryOnboard error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "VEHICLE_ALREADY_EXISTS") {
        APIResponseBadRequest(req, res, e.errcode, {}, e.message);
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

  SearchVehicles = async (req, res, next) => {
    try {
      const schema = z.object({
        searchtext: z
          .string({ message: "Search text is required" })
          .min(2, { message: "Search text must be at least 2 characters" }),
        offset: z
          .number({ message: "Offset must be a number" })
          .optional()
          .default(0),
        limit: z
          .number({ message: "Limit must be a number" })
          .optional()
          .default(100),
      });

      const { searchtext, offset, limit } = validateAllInputs(schema, {
        searchtext: req.query.searchtext,
        offset: parseQueryInt(req.query.offset),
        limit: parseQueryInt(req.query.limit),
      });

      const result = await this.vehicleHdlrImpl.SearchVehiclesLogic(
        searchtext,
        offset,
        limit
      );
      APIResponseOK(req, res, result, "Vehicles searched successfully");
    } catch (e) {
      this.logger.error("SearchVehicles error:", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "SEARCH_VEHICLES_ERR",
          e.toString(),
          "Search vehicles failed"
        );
      }
    }
  };

  GetVehicleHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.vehicle.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get vehicle history."
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

      let result = await this.vehicleHdlrImpl.GetVehicleHistoryLogic(
        starttime,
        endtime
      );
      APIResponseOK(req, res, result, "Vehicle history fetched successfully");
    } catch (e) {
      this.logger.error("GetVehicleHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "GET_VEHICLE_HISTORY_ERR",
          e.toString(),
          "Get vehicle history failed"
        );
      }
    }
  };
  VehicleLastConnected = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.vehicle.admin",
          "consolemgmt.vehicle.view",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to get vehicle CAN+GPS data."
        );
      }
      let schema = z.object({
        value: z
          .array(
            z
              .string({ message: "Invalid Value format" })
              .nonempty({ message: "Value cannot be empty" })
              .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 ]*[A-Za-z0-9])?$/, {
                message: "Value must be a valid VIN or Registration number",
              })
              .max(128, { message: "Value must not exceed 128 characters" })
          )
          .min(1, { message: "At least one value is required" }),
        type: z.enum(["vinno", "regno"], {
          message: "Type must be either vinno or regno",
        }),
      });

      let { value, type } = validateAllInputs(schema, {
        value: req.body.value,
        type: req.body.type,
      });

      let result = await this.vehicleHdlrImpl.VehicleLastConnectedLogic(
        value,
        type
      );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle last connected data fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetVehicleLastConnectedData error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_VEHICLE_LAST_CONNECTED_DATA_ERR",
          e.toString(),
          "Get vehicle last connected data failed"
        );
      }
    }
  };
}
