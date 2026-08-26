import z from "zod";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import RoleHdlrImpl from "./rolehdlr_impl.js";
import { UUID_PATTERN } from "../../../utils/constant.js";

export default class RoleHdlr {
  constructor(roleSvcI, logger) {
    this.roleSvcI = roleSvcI;
    this.logger = logger;
    this.roleHdlrImpl = new RoleHdlrImpl(roleSvcI, logger);
  }

  RegisterRoutes(router) {
    router.post("/", this.CreateRole);
    router.put(`/:roleid(${UUID_PATTERN})`, this.UpdateRole);
    router.get("/list", this.ListRoles);
    router.get(`/:roleid(${UUID_PATTERN})`, this.GetRoleInfo);
    router.put(`/:roleid(${UUID_PATTERN})/perms`, this.UpdateRolePerms);
    router.delete(`/:roleid(${UUID_PATTERN})`, this.DeleteRole);
    router.get("/history", this.GetRoleHistory);
    router.get("/perms/history", this.GetRolePermHistory);
  }

  CreateRole = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.role.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to create role."
      );
    }
    try {
      const createdby = req.userid;
      const schema = z.object({
        rolename: z
          .string({ message: "Invalid Role Name format" })
          .nonempty({ message: "Role Name is required" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Role Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }).max(128, {
            message: "Role Name must be at most 128 characters long",
          }),

        roletype: z.literal("platform", {
          errorMap: () => ({ message: "Invalid role type" }),
        }),

        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
      });

      const { rolename, roletype, isenabled } = validateAllInputs(schema, {
        rolename: req.body.rolename,
        roletype: req.body.roletype,
        isenabled: req.body.isenabled,
      });

      const result = await this.roleHdlrImpl.CreateRoleLogic(
        rolename,
        roletype,
        isenabled !== undefined ? isenabled : true,
        createdby
      );

      APIResponseOK(req, res, result, "Role created successfully");
    } catch (e) {
      this.logger.error("CreateRole error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.message === "ROLE_NAME_ALREADY_EXISTS") {
        APIResponseBadRequest(
          req,
          res,
          "ROLE_NAME_ALREADY_EXISTS",
          null,
          "Role name already exists"
        );
        return;
      } else {
        APIResponseInternalErr(
          req,
          res,
          "CREATE_ROLE_ERR",
          e.toString(),
          "Create role failed"
        );
      }
    }
  };

  UpdateRole = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.role.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to update role."
      );
    }
    try {
      const updatedby = req.userid;
      const roleid = req.params.roleid;
      const schema = z.object({
        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" }),
        rolename: z
          .string({ message: "Invalid Role Name format" })
          .max(128, { message: "Role Name must be at most 128 characters" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Role Name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .optional(),

        roletype: z
          .enum(["platform"], { message: "Invalid Role Type format" })
          .optional(),
        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
      });
      let { rolename, roletype, isenabled } = validateAllInputs(schema, {
        updatedby,
        roleid,
        rolename: req.body.rolename,
        roletype: req.body.roletype,
        isenabled: req.body.isenabled,
      });
      if (roletype && roletype !== "platform") {
        APIResponseBadRequest(
          req,
          res,
          "INVALID_ROLE_TYPE",
          "Invalid role type"
        );
        return;
      }
      let updateFields = {};
      if (rolename !== undefined) updateFields.rolename = rolename;
      if (roletype !== undefined) updateFields.roletype = roletype;
      if (isenabled !== undefined) updateFields.isenabled = isenabled;

      if (Object.keys(updateFields).length === 0) {
        APIResponseBadRequest(
          req,
          res,
          "NO_UPDATE_FIELDS",
          "No fields provided for update"
        );
        return;
      }
      let result = await this.roleHdlrImpl.UpdateRoleLogic(
        roleid,
        updateFields,
        updatedby
      );
      APIResponseOK(req, res, result, "Role updated successfully");
    } catch (e) {
      this.logger.error("UpdateRole error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_ROLE_ERR",
          e.toString(),
          "Update role failed"
        );
      }
    }
  };

  ListRoles = async (req, res, next) => {
    // if (
    //   !CheckUserPerms(req.userperms, [
    //     "consolemgmt.role.view",
    //     "consolemgmt.role.admin",
    //   ])
    // ) {
    //   return APIResponseForbidden(
    //     req,
    //     res,
    //     "INSUFFICIENT_PERMISSIONS",
    //     null,
    //     "You don't have permission to list roles."
    //   );
    // }
    try {
      let result = await this.roleHdlrImpl.ListRolesLogic();
      APIResponseOK(req, res, result, "Roles fetched successfully");
    } catch (e) {
      this.logger.error("ListRoles error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_ROLES_ERR",
        e.toString(),
        "List roles failed"
      );
    }
  };

  GetRoleInfo = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.role.view",
        "consolemgmt.role.admin",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get role."
      );
    }
    try {
      const schema = z.object({
        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" }),
      });

      const { roleid } = validateAllInputs(schema, {
        roleid: req.params.roleid,
      });

      const result = await this.roleHdlrImpl.GetRoleInfoLogic(roleid);
      APIResponseOK(req, res, result, "Role fetched successfully");
    } catch (e) {
      this.logger.error("GetRoleInfo error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ROLE_ERR",
          e.toString(),
          "Get role failed"
        );
      }
    }
  };

  UpdateRolePerms = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.role.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to update role permissions."
      );
    }
    try {
      const updatedby = req.userid;
      const schema = z.object({
        updatedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" }),
        updatedperms: z.array(
          z.object({
            moduleid: z
              .string({ message: "Invalid Module ID format" })
              .uuid({ message: "Module ID must be a valid UUID" }),
            selectedpermids: z
              .array(
                z.string().min(1, { message: "Permission ID cannot be empty" })
              )
              .optional(),
            deselectedpermids: z
              .array(
                z.string().min(1, { message: "Permission ID cannot be empty" })
              )
              .optional(),
          })
        ),
      });

      let { updatedperms } = validateAllInputs(schema, {
        updatedby,
        roleid: req.params.roleid,
        updatedperms: req.body.updatedperms,
      });

      let result = await this.roleHdlrImpl.UpdateRolePermsLogic(
        req.params.roleid,
        updatedperms,
        updatedby
      );
      APIResponseOK(req, res, result, "Role permissions updated successfully");
    } catch (e) {
      this.logger.error("UpdateRolePerms error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "CANNOT_UPDATE_SUPER_ADMIN_ROLE") {
        APIResponseForbidden(req, res, e.errcode, null, e.message);
        return;
      } else {
        APIResponseInternalErr(
          req,
          res,
          "UPDATE_ROLE_PERMS_ERR",
          e.toString(),
          "Update role permissions failed"
        );
      }
    }
  };

  DeleteRole = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.role.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to delete role."
      );
    }
    try {
      const schema = z.object({
        roleid: z
          .string({ message: "Invalid Role ID format" })
          .uuid({ message: "Role ID must be a valid UUID" }),

        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
      });

      const { roleid, deletedby } = validateAllInputs(schema, {
        roleid: req.params.roleid,
        deletedby: req.userid,
      });

      let result = await this.roleHdlrImpl.DeleteRoleLogic(roleid, deletedby);

      APIResponseOK(req, res, result, "Role deleted successfully");
    } catch (e) {
      this.logger.error("DeleteRole error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "ROLE_IN_USE" ||
        e.errcode === "ROLE_HAS_PERMISSIONS" ||
        e.errcode === "ROLE_NOT_FOUND" ||
        e.errcode === "CANNOT_DELETE_ADMIN_ROLE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_ROLE_ERR",
          e.toString(),
          "Delete role failed"
        );
      }
    }
  };

  GetRoleHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.role.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get role history."
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

      let result = await this.roleHdlrImpl.GetRoleHistoryLogic(starttime, endtime);
      APIResponseOK(req, res, result, "Role history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetRoleHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "GET_ROLE_HISTORY_ERR", e.toString(), "Get role history failed");
      }
    }
  };

  GetRolePermHistory = async (req, res, next) => {
    if (!CheckUserPerms(req.userperms, ["consolemgmt.role.admin"])) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get role perm history."
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

      let result = await this.roleHdlrImpl.GetRolePermHistoryLogic(starttime, endtime);
      APIResponseOK(req, res, result, "Role perm history fetched successfully");
    }
    catch (e) {
      this.logger.error("GetRolePermHistory error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(req, res, "GET_ROLE_PERM_HISTORY_ERR", e.toString(), "Get role perm history failed");
      }
    }
  };
  
}
