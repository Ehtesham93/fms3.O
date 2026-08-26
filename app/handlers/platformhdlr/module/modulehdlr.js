import z from "zod";
import {
  ValidateModuleCode,
  ValidatePermissionId,
} from "../../../utils/commonutil.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import ModuleHdlrImpl from "./modulehdlr_impl.js";
import { UUID_PATTERN } from "../../../utils/constant.js";
export default class ModuleHdlr {
  constructor(moduleSvcI, userSvcI, logger) {
    this.moduleSvcI = moduleSvcI;
    this.userSvcI = userSvcI;
    this.logger = logger;
    this.moduleHdlrImpl = new ModuleHdlrImpl(moduleSvcI, userSvcI, logger);
  }

  RegisterRoutes(router) {
    router.post("/", this.CreateModule);
    router.get("/types", this.GetModuleTypes);
    router.get("/list", this.ListModules);
    router.get(`/:moduleid(${UUID_PATTERN})`, this.GetModule);
    router.put(`/:moduleid(${UUID_PATTERN})`, this.UpdateModule);
    router.post(`/:moduleid(${UUID_PATTERN})/perm`, this.AddModulePerm);
    router.post(`/:moduleid(${UUID_PATTERN})/perms`, this.AddModulePerms);
    router.put(
      `/:moduleid(${UUID_PATTERN})/perm/:permid`,
      this.UpdateModulePerm
    );
    router.delete(
      `/:moduleid(${UUID_PATTERN})/perm/:permid`,
      this.DeleteModulePerm
    );
    router.delete(`/:moduleid(${UUID_PATTERN})`, this.DeleteModule);
    router.get(`/history`, this.GetModuleHistory);
    router.get(`/perm/history`, this.GetModulePermHistory);
    router.get(`/:modulecode/isavailable`, this.IsModuleCodeAvailable);
  }

  GetModuleTypes = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.module.view",
        "consolemgmt.module.admin",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get module types."
      );
    }
    try {
      let result = await this.moduleHdlrImpl.GetModuleTypesLogic();
      APIResponseOK(req, res, result, "Module types fetched successfully");
    } catch (e) {
      this.logger.error("GetModuleTypes error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "GET_MODULE_TYPES_ERR",
        e.toString(),
        "Get module types failed"
      );
    }
  };

  CreateModule = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create module."
      );
    }
    try {
      let schema = z.object({
        modulename: z
          .string({ message: "Invalid module name format" })
          .nonempty({ message: "Module name cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Module name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Module name must be at most 128 characters" }),
        moduletype: z
          .string({ message: "Invalid module type format" })
          .nonempty({ message: "Module type cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Module type can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Module type must not exceed 128 characters" }),
        modulecode: z
          .string({ message: "Invalid module code format" })
          .nonempty({ message: "Module code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Module code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Module code must not exceed 128 characters" }),
        creditspervehicleday: z
          .number({ message: "creditspervehicleday must be a number" })
          .min(0, { message: "creditspervehicleday must be non-negative" })
          .optional()
          .default(0),
      });
      let { modulename, moduletype, modulecode, creditspervehicleday } =
        validateAllInputs(schema, {
          modulename: req.body.modulename,
          moduletype: req.body.moduletype,
          modulecode: req.body.modulecode,
          creditspervehicleday: req.body.creditspervehicleday,
        });

      if (!ValidateModuleCode(modulecode)) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_MODULE_CODE",
          "Invalid module code"
        );
        return;
      }
      let createdby = req.userid;
      let result = await this.moduleHdlrImpl.CreateModuleLogic(
        modulename,
        moduletype,
        modulecode,
        creditspervehicleday,
        createdby
      );
      APIResponseOK(req, res, result, "Module created successfully");
    } catch (e) {
      this.logger.error("CreateModule error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "MODULE_CODE_ALREADY_EXISTS") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_MODULE_ERR",
          e.toString(),
          "Create module failed"
        );
      }
    }
  };

  ListModules = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.module.admin",
        "consolemgmt.module.view",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to list modules."
      );
    }
    try {
      let result = await this.moduleHdlrImpl.ListModulesLogic();
      APIResponseOK(req, res, result, "Modules fetched successfully");
    } catch (e) {
      this.logger.error("ListModules error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_MODULES_ERR",
        e.toString(),
        "List modules failed"
      );
    }
  };

  GetModule = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.module.admin",
        "consolemgmt.module.view",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get module."
      );
    }
    try {
      let schema = z.object({
        moduleid: z
          .string({ message: "Module ID is required" })
          .uuid({ message: "Module ID must be a valid UUID" }),
      });

      let { moduleid } = validateAllInputs(schema, {
        moduleid: req.params.moduleid,
      });

      let result = await this.moduleHdlrImpl.GetModuleLogic(moduleid);
      APIResponseOK(req, res, result, "Module fetched successfully");
    } catch (e) {
      this.logger.error("GetModule error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_MODULE_ERR",
          e.toString(),
          "Get module failed"
        );
      }
    }
  };

  UpdateModule = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to update module."
      );
    }
    try {
      const schema = z.object({
        moduleid: z
          .string({ message: "Invalid Module ID format" })
          .uuid({ message: "Module ID must be a valid UUID" }),

        modulename: z
          .string({ message: "Invalid Module Name format" })
          .nonempty({ message: "Module Name cannot be empty" })
          .max(128, { message: "Module Name must be at most 128 characters" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Module Name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .optional(),

        moduletype: z
          .string({ message: "Invalid module type format" })
          .nonempty({ message: "Module type cannot be empty" })
          .max(128, { message: "Module type must not exceed 128 characters" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Module type can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .optional(),

        creditspervehicleday: z
          .preprocess((val) => Number(val), z.number().min(0))
          .optional()
          .default(0),

        moduleinfo: z
          .object({
            moduleurl: z
              .string()
              .optional()
              .refine(
                (url) =>
                  !url ||
                  /^(https?:\/\/)([\w.-]+)(:\d+)?(\/[\w./-]+)$/.test(url),
                {
                  message: "Invalid module URL format",
                }
              ),

            showfleets: z.boolean().optional(),
            showaccounts: z.boolean().optional(),
          })
          .optional()
          .default({
            moduleurl: "",
            showfleets: false,
            showaccounts: false,
          }),

        isenabled: z
          .preprocess((val) => val === "true" || val === true, z.boolean())
          .optional()
          .default(false),

        priority: z
          .number({ message: "priority must be a number" })
          .min(0, { message: "priority must be non-negative" })
          .optional(),

        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const validatedData = validateAllInputs(schema, {
        moduleid: req.params.moduleid,
        ...req.body,
        updatedby: req.userid,
      });

      const updateFields = {};
      const allowedFields = [
        "modulename",
        "moduletype",
        "creditspervehicleday",
        "moduleinfo",
        "isenabled",
        "priority",
      ];

      for (const field of allowedFields) {
        if (req.body.hasOwnProperty(field)) {
          updateFields[field] = validatedData[field];
        }
      }

      if (Object.keys(updateFields).length === 0) {
        return APIResponseBadRequest(
          req,
          res,
          "NO_UPDATE_FIELDS",
          "No valid fields provided for update"
        );
      }

      let result = await this.moduleHdlrImpl.UpdateModuleLogic(
        validatedData.moduleid,
        updateFields,
        validatedData.updatedby
      );

      APIResponseOK(req, res, result, "Module updated successfully");
    } catch (e) {
      this.logger.error("UpdateModule error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_MODULE_ERR",
          e.toString(),
          "Update module failed"
        );
      }
    }
  };

  AddModulePerm = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to add module permission."
      );
    }
    try {
      let createdby = req.userid;

      const schema = z.object({
        moduleid: z
          .string({ message: "Invalid Module ID format" })
          .uuid({ message: "Module ID must be a valid UUID" }),

        permid: z
          .string({ message: "Invalid Permission ID format" })
          .nonempty({ message: "Permission ID cannot be empty" })
          .max(128, {
            message: "Permission ID must not exceed 128 characters",
          }),

        isenabled: z.boolean().optional(),
        moduleperminfo: z.record(z.any()).optional(),

        createdby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { moduleid, permid, isenabled, moduleperminfo } = validateAllInputs(
        schema,
        {
          moduleid: req.params.moduleid,
          permid: req.body.permid,
          isenabled: req.body.isenabled,
          moduleperminfo: req.body.moduleperminfo,
          createdby,
        }
      );

      const result = await this.moduleHdlrImpl.AddModulePermLogic(
        moduleid,
        permid,
        !!isenabled,
        moduleperminfo,
        createdby
      );

      APIResponseOK(req, res, result, "Module permission added successfully");
    } catch (e) {
      this.logger.error("AddModulePerm error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "ADD_MODULE_PERM_ERR",
          e.toString(),
          "Add module permission failed"
        );
      }
    }
  };

  AddModulePerms = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to add module permissions."
      );
    }
    try {
      let createdby = req.userid;

      const schema = z.object({
        moduleid: z
          .string({ message: "Invalid Module ID format" })
          .uuid({ message: "Module ID must be a valid UUID" }),

        permids: z
          .array(
            z
              .string({ message: "Each Permission ID must be a string" })
              .nonempty({ message: "Permission ID cannot be empty" })
              .max(128, {
                message: "Permission ID must not exceed 128 characters",
              })
          )
          .min(1, { message: "At least one permission ID is required" }),

        createdby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { moduleid, permids } = validateAllInputs(schema, {
        moduleid: req.params.moduleid,
        permids: req.body.permids,
        createdby,
      });

      const result = await this.moduleHdlrImpl.AddModulePermsLogic(
        moduleid,
        permids,
        createdby
      );

      APIResponseOK(req, res, result, "Module permissions added successfully");
    } catch (e) {
      this.logger.error("AddModulePerms error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "ADD_MODULE_PERMS_ERR",
          e.toString(),
          "Add module permissions failed"
        );
      }
    }
  };

  UpdateModulePerm = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to update module permission."
      );
    }
    try {
      let updatedby = req.userid;
      let moduleid = req.params.moduleid;
      let permid = req.params.permid;
      let schema = z.object({
        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
        moduleid: z
          .string({ message: "Invalid Module ID format" })
          .uuid({ message: "Module ID must be a valid UUID" }),
        permid: z
          .string({ message: "Invalid Permission ID format" })
          .nonempty({ message: "Permission ID cannot be empty" })
          .max(128, {
            message: "Permission ID must not exceed 128 characters",
          }),
      });

      validateAllInputs(schema, {
        updatedby,
        moduleid,
        permid,
      });

      if (!ValidatePermissionId(permid)) {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_PERMISSION_ID",
          "Invalid permission id"
        );
        return;
      }
      let {
        moduleid: bodyModuleId,
        permid: bodyPermId,
        ...updateFields
      } = req.body;
      let result = await this.moduleHdlrImpl.UpdateModulePermLogic(
        moduleid,
        permid,
        updateFields,
        updatedby
      );

      APIResponseOK(req, res, result, "Module permission updated successfully");
    } catch (e) {
      this.logger.error("UpdateModulePerm error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_MODULE_PERM_ERR",
          e.toString(),
          "Update module permission failed"
        );
      }
    }
  };

  DeleteModulePerm = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to delete module permission."
      );
    }
    try {
      let updatedby = req.userid;

      const schema = z.object({
        moduleid: z
          .string({ message: "Module ID is required" })
          .uuid({ message: "Module ID must be a valid UUID" }),

        permid: z
          .string({ message: "Permission ID is required" })
          .nonempty({ message: "Permission ID cannot be empty" })
          .max(128, {
            message: "Permission ID must not exceed 128 characters",
          }),

        updatedby: z
          .string({ message: "User ID is required" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { moduleid, permid } = validateAllInputs(schema, {
        moduleid: req.params.moduleid,
        permid: req.params.permid,
        updatedby,
      });

      let result = await this.moduleHdlrImpl.DeleteModulePermLogic(
        moduleid,
        permid,
        updatedby
      );

      APIResponseOK(req, res, result, "Module permission deleted successfully");
    } catch (e) {
      this.logger.error("DeleteModulePerm error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "PERMISSION_ASSOCIATED_WITH_ROLES" ||
        e.errcode === "PERMISSION_NOT_FOUND"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_MODULE_PERM_ERR",
          e.toString(),
          "Delete module permission failed"
        );
      }
    }
  };

  DeleteModule = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to delete module."
      );
    }
    try {
      const schema = z.object({
        moduleid: z
          .string({ message: "Invalid Module ID format" })
          .uuid({ message: "Module ID must be a valid UUID" }),

        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { moduleid, deletedby } = validateAllInputs(schema, {
        moduleid: req.params.moduleid,
        deletedby: req.userid,
      });

      let result = await this.moduleHdlrImpl.DeleteModuleLogic(
        moduleid,
        deletedby
      );

      APIResponseOK(req, res, result, "Module deleted successfully");
    } catch (e) {
      this.logger.error("DeleteModule error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if(e.code === '23503' && e.constraint === 'module_perm_permid_fkey'){
        return APIResponseBadRequest(req, res, 'PERMISSION_ASSOCIATED_WITH_MODULES', null, "Cannot delete module. Remove assigned permissions and try again.");
      } else if(e.errcode === 'MODULE_ASSIGNED_TO_PACKAGES'){
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_MODULE_ERR",
          e.toString(),
          "Delete module failed"
        );
      }
    }
  };

  GetModuleHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get module history."
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

      let result = await this.moduleHdlrImpl.GetModuleHistoryLogic( starttime, endtime);
      APIResponseOK(req, res, result, "Module history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetModuleHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "GET_MODULE_HISTORY_ERR", e.toString(), "Get module history failed");
      }
    }
  };

  GetModulePermHistory = async (req, res, next) => {
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
      let result = await this.moduleHdlrImpl.GetModulePermHistoryLogic(starttime, endtime);
      APIResponseOK(req, res, result, "Module perm history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetModulePermHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "GET_MODULE_PERM_HISTORY_ERR", e.toString(), "Get module perm history failed");
      }
    }
  };

  IsModuleCodeAvailable = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.module.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get module history."
      );
    }
    try {
      let schema = z.object({
        modulecode: z
          .string({ message: "Invalid Module Code format" })
          .nonempty({ message: "Module Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Module Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Module Code must be at most 128 characters" }),
      });
      const { modulecode } = validateAllInputs(schema, {
        modulecode: req.params.modulecode,
      });

      let result = await this.moduleHdlrImpl.IsModuleCodeAvailableLogic(modulecode);
      APIResponseOK(req, res, result, "Module code availability checked successfully");
    }
    catch (e) {
      this.logger.error("IsModuleCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "IS_MODULE_CODE_AVAILABLE_ERR", e.toString(), "Check module code availability failed");
      }
    }
  };
}
