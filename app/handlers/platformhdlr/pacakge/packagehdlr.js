import z from "zod";
import { UUID_PATTERN } from "../../../utils/constant.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import PackageHdlrImpl from "./packagehdlr_impl.js";
export default class PackageHdlr {
  constructor(packageSvcI, logger) {
    this.packageSvcI = packageSvcI;
    this.logger = logger;
    this.packageHdlrImpl = new PackageHdlrImpl(this.packageSvcI, logger);
  }

  RegisterRoutes(router) {
    router.post("/type", this.CreatePackageType);
    router.get("/types", this.GetPackageTypes);
    router.post("/", this.CreatePackage);
    router.put(`/:pkgid(${UUID_PATTERN})`, this.UpdatePackage);
    router.get("/list", this.ListPackages);
    router.get(`/:pkgid(${UUID_PATTERN})`, this.GetPkgInfo);
    router.put(`/:pkgid(${UUID_PATTERN})/modules`, this.UpdatePkgModules);
    router.delete(`/:pkgid(${UUID_PATTERN})`, this.DeletePackage);
    router.get("/history", this.GetPackageHistory);
    router.get("/modules/history", this.GetPackageModHistory);
  }

  CreatePackageType = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.package.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create package type."
      );
    }
    try {
      const createdby = req.userid;

      const schema = z.object({
        pkgtype: z.enum(["standard", "custom"], {
          message: "Package type must be either 'standard' or 'custom'",
        }),
      });

      const { pkgtype } = validateAllInputs(schema, {
        pkgtype: req.body.pkgtype,
      });

      const result = await this.packageHdlrImpl.CreatePackageTypeLogic(
        pkgtype,
        createdby
      );

      APIResponseOK(req, res, result, "Package type created successfully");
    } catch (e) {
      this.logger.error("CreatePackageType error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, "INPUT_ERROR", e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_PACKAGE_TYPE_ERR",
          e.toString(),
          "Create package type failed"
        );
      }
    }
  };

  GetPackageTypes = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.package.view",
        "consolemgmt.package.admin",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get package types."
      );
    }
    try {
      let result = await this.packageHdlrImpl.GetPackageTypesLogic();
      APIResponseOK(req, res, result, "Package types fetched successfully");
    } catch (e) {
      this.logger.error("GetPackageTypes error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "GET_PACKAGE_TYPES_ERR",
        e.toString(),
        "Get package types failed"
      );
    }
  };

  CreatePackage = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.package.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create package."
      );
    }
    try {
      const createdby = req.userid;

      const schema = z.object({
        pkgname: z
          .string({ message: "Package Name must be a string" })
          .nonempty({ message: "Package Name cannot be empty" })
          .max(128, { message: "Package Name must be at most 128 characters" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Package Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
        pkgtype: z.enum(["standard", "custom"], {
          message: "Package type must be either 'standard' or 'custom'",
        }),

        pkginfo: z
          .record(z.any(), { message: "Package info must be an object" })
          .optional(),

        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
      });

      const { pkgname, pkgtype, pkginfo, isenabled } = validateAllInputs(
        schema,
        {
          pkgname: req.body.pkgname,
          pkgtype: req.body.pkgtype,
          pkginfo: req.body.pkginfo,
          isenabled: req.body.isenabled,
        }
      );

      const result = await this.packageHdlrImpl.CreatePkgLogic(
        pkgname,
        pkgtype,
        pkginfo || {},
        isenabled !== undefined ? isenabled : true,
        createdby
      );

      APIResponseOK(req, res, result, "Package created successfully");
    } catch (e) {
      this.logger.error("CreatePackage error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, "INPUT_ERROR", e.errdata, e.message);
      } else if (e.errcode === "PACKAGE_NAME_ALREADY_EXISTS") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_PACKAGE_ERR",
          e.toString(),
          "Create package failed"
        );
      }
    }
  };

  ListPackages = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.package.admin",
        "consolemgmt.package.view",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to list packages."
      );
    }
    try {
      let result = await this.packageHdlrImpl.ListPackagesLogic();
      APIResponseOK(req, res, result, "Packages fetched successfully");
    } catch (e) {
      this.logger.error("ListPackages error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_PACKAGES_ERR",
        e.toString(),
        "List packages failed"
      );
    }
  };

  UpdatePackage = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.package.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to update package."
      );
    }
    try {
      const updatedby = req.userid;
      let pkgid = req.params.pkgid;
      let schema = z.object({
        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        pkgid: z
          .string({ message: "Invalid Package ID format" })
          .uuid({ message: "Package ID must be a valid UUID" }),
      });
      validateAllInputs(schema, {
        updatedby,
        pkgid,
      });
      let { pkgid: bodypkgid, ...updateFields } = req.body;
      let result = await this.packageHdlrImpl.UpdatePackageLogic(
        pkgid,
        updateFields,
        updatedby
      );
      APIResponseOK(req, res, result, "Package updated successfully");
    } catch (e) {
      this.logger.error("UpdatePackage error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_PACKAGE_ERR",
          e.toString(),
          "Update package failed"
        );
      }
    }
  };

  GetPkgInfo = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.package.view",
        "consolemgmt.package.admin",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get package info."
      );
    }
    try {
      let schema = z.object({
        pkgid: z
          .string({ message: "Invalid Package ID format" })
          .uuid({ message: "Package ID must be a valid UUID" }),
      });
      let { pkgid } = validateAllInputs(schema, {
        pkgid: req.params.pkgid,
      });
      let result = await this.packageHdlrImpl.GetPkgInfoLogic(pkgid);
      APIResponseOK(req, res, result, "Package info fetched successfully");
    } catch (e) {
      this.logger.error("GetPkgInfo error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, "INPUT_ERROR", e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_PKG_INFO_ERR",
          e.toString(),
          "Get package info failed"
        );
      }
    }
  };

  UpdatePkgModules = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.package.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to update package modules."
      );
    }
    try {
      const updatedby = req.userid;
      let pkgid = req.params.pkgid;
      let schema = z.object({
        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        pkgid: z
          .string({ message: "Invalid Package ID format" })
          .uuid({ message: "Package ID must be a valid UUID" }),

        selectedmodules: z
          .array(z.string().nonempty({ message: "Module ID cannot be empty" }))
          .optional(),

        deselectedmodules: z
          .array(z.string().nonempty({ message: "Module ID cannot be empty" }))
          .optional(),
      });

      let { selectedmodules = [], deselectedmodules = [] } = validateAllInputs(
        schema,
        {
          updatedby,
          pkgid,
          selectedmodules: req.body.selectedmodules,
          deselectedmodules: req.body.deselectedmodules,
        }
      );

      let result = await this.packageHdlrImpl.UpdatePkgModulesLogic(
        pkgid,
        selectedmodules,
        deselectedmodules,
        updatedby
      );
      APIResponseOK(req, res, result, "Package modules updated successfully");
    } catch (e) {
      this.logger.error("UpdatePkgModules error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, "INPUT_ERROR", e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_PKG_MODULES_ERR",
          e.toString(),
          "Update package modules failed"
        );
      }
    }
  };

  DeletePackage = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.package.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to delete package."
      );
    }
    try {
      const schema = z.object({
        pkgid: z
          .string({ message: "Invalid Package ID format" })
          .uuid({ message: "Package ID must be a valid UUID" }),

        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { pkgid, deletedby } = validateAllInputs(schema, {
        pkgid: req.params.pkgid,
        deletedby: req.userid,
      });

      let result = await this.packageHdlrImpl.DeletePackageLogic(
        pkgid,
        deletedby
      );

      APIResponseOK(req, res, result, "Package deleted successfully");
    } catch (e) {
      this.logger.error("DeletePackage error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          e.errdata,
          e.message
        );
      } else if (
        e.errcode === "PACKAGE_IN_USE" ||
        e.errcode === "PACKAGE_HAS_MODULES" ||
        e.errcode === "PACKAGE_HAS_HISTORY"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_PACKAGE_ERR",
          e.toString(),
          "Delete package failed"
        );
      }
    }
  };

  GetPackageHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.package.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get package history."
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

      let result = await this.packageHdlrImpl.GetPackageHistoryLogic(starttime, endtime);
      APIResponseOK(req, res, result, "Package history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetPackageHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "GET_PACKAGE_HISTORY_ERR", e.toString(), "Get package history failed");
      }
    }
  };

  GetPackageModHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get module perm history."
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
      let result = await this.packageHdlrImpl.GetPackageModHistoryLogic(starttime, endtime);
      APIResponseOK(req, res, result, "Module perm history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetPackageModHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "GET_MODULE_PERM_HISTORY_ERR", e.toString(), "Get module perm history failed");
      }
    }
  };
}