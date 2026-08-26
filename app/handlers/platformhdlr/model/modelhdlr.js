import z from "zod";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import ModelHdlrImpl from "./modelhdlr_impl.js";

export default class ModelHdlr {
  constructor(modelSvcI, userSvcI, logger) {
    this.modelSvcI = modelSvcI;
    this.userSvcI = userSvcI;
    this.logger = logger;
    this.modelHdlrImpl = new ModelHdlrImpl(modelSvcI, userSvcI, logger);
  }

  RegisterRoutes(router) {
    // param family CRUD
    router.post("/paramfamily", this.CreateParamFamily);
    router.put(`/paramfamily/:paramfamilycode`, this.UpdateParamFamily);
    router.delete(`/paramfamily/:paramfamilycode`, this.DeleteParamFamily);

    // parameter CRUD
    router.post("/param", this.CreateModelParam);
    router.put(`/param/:paramfamilycode/:paramcode`, this.UpdateModelParam);
    router.delete(`/param/:paramfamilycode/:paramcode`, this.DeleteModelParam);

    // family CRUD
    router.post("/family", this.CreateModelFamily);
    router.put(`/family/:familycode`, this.UpdateModelFamily);
    router.delete(`/family/:familycode`, this.DeleteModelFamily);
    router.post("/family/param", this.CreateModelFamilyParam);
    router.delete(
      "/family/param/:familycode/:paramfamilycode/:paramcode",
      this.DeleteModelFamilyParam
    );

    // vehicle model CRUD
    router.post("/", this.CreateVehicleModel);
    router.put("/:modelcode", this.UpdateVehicleModel);
    router.delete("/:modelcode", this.DeleteVehicleModel);
  }

  RegisterNoPermsRoutes(router) {
    // param family
    router.get("/paramfamily/list", this.ListParamFamilies);
    router.get(
      "/isparamfamilycodeavailable/:paramfamilycode",
      this.IsParamFamilyCodeAvailable
    );

    // parameter
    router.get(
      "/isparamcodeavailable/:paramfamilycode/:paramcode",
      this.IsParamCodeAvailable
    );

    router.get("/param/list", this.ListModelParams);
    router.get("/param/list/:paramfamilycode", this.ListModelParamsByFamily);

    // family
    router.get("/family/list", this.ListModelFamilies);
    router.get(
      "/isfamilycodeavailable/:familycode",
      this.IsFamilyCodeAvailable
    );
    router.get(
      "/family/param/:familycode/:paramfamilycode",
      this.ListModelFamilyParams
    );

    // vehicle model
    router.get("/list", this.ListVehicleModels);
    router.get("/ismodelcodeavailable/:modelcode", this.IsModelCodeAvailable);
    router.get(
      "/ismodelnamevariantavailable/:modelname/:modelvariant",
      this.IsModelNameVariantAvailable
    );
    router.get("/getallmodelswithfamily", this.GetAllModelsWithFamily);
  }

  CreateParamFamily = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create param family."
        );
      }
      let createdby = req.userid;

      const schema = z.object({
        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),

        paramfamilyname: z
          .string({ message: "Invalid Param Family Name format" })
          .nonempty({ message: "Param Family Name cannot be empty" })
          .max(128, {
            message: "Param Family Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),

        paramfamilyinfo: z
          .record(z.any(), { message: "Param Family Info must be an object" })
          .optional(),
      });

      const { paramfamilycode, paramfamilyname, paramfamilyinfo } =
        validateAllInputs(schema, {
          paramfamilycode: req.body.paramfamilycode,
          paramfamilyname: req.body.paramfamilyname,
          paramfamilyinfo: req.body.paramfamilyinfo,
        });

      const isenabled = true;

      const result = await this.modelHdlrImpl.CreateParamFamilyLogic(
        paramfamilycode,
        paramfamilyname,
        paramfamilyinfo || {},
        isenabled,
        createdby
      );

      APIResponseOK(req, res, result, "Param family created successfully");
    } catch (e) {
      this.logger.error("CreateParamFamily error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "PARAM_FAMILY_CODE_ALREADY_EXISTS") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_PARAM_FAMILY_ERR",
          e.toString(),
          "Create param family failed"
        );
      }
    }
  };

  ListParamFamilies = async (req, res, next) => {
    try {
      let result = await this.modelHdlrImpl.ListParamFamiliesLogic();
      APIResponseOK(req, res, result, "Param families fetched successfully");
    } catch (e) {
      this.logger.error("ListParamFamilies error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_PARAM_FAMILIES_ERR",
        e.toString(),
        "List param families failed"
      );
    }
  };

  UpdateParamFamily = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update param family."
        );
      }
      let schema = z.object({
        paramfamilycode: z
          .string({ message: "Param Family Code is required" })
          .nonempty({ message: "Param Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),
        paramfamilyname: z
          .string({ message: "Invalid Param Family Name format" })
          .max(128, {
            message: "Param Family Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .optional(),

        paramfamilyinfo: z.record(z.any()).optional(),
        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
      });
      let updatedby = req.userid;

      let { paramfamilycode, ...updateFields } = validateAllInputs(schema, {
        paramfamilycode: req.params.paramfamilycode,
        ...req.body,
      });

      let result = await this.modelHdlrImpl.UpdateParamFamilyLogic(
        paramfamilycode,
        updateFields,
        updatedby
      );

      APIResponseOK(req, res, result, "Param family updated successfully");
    } catch (e) {
      this.logger.error("UpdateParamFamily error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "PARAM_FAMILY_CODE_NOT_FOUND") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_PARAM_FAMILY_ERR",
          e.toString(),
          "Update param family failed"
        );
      }
    }
  };

  DeleteParamFamily = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete param family."
        );
      }
      let schema = z.object({
        paramfamilycode: z
          .string({
            message: "Invalid Param Family Code format",
          })
          .nonempty({ message: "Invalid Param Family Code format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),
        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
      });

      let { paramfamilycode, deletedby } = validateAllInputs(schema, {
        paramfamilycode: req.params.paramfamilycode,
        deletedby: req.userid,
      });

      let result = await this.modelHdlrImpl.DeleteParamFamilyLogic(
        paramfamilycode,
        deletedby
      );

      APIResponseOK(req, res, result, "Param family deleted successfully");
    } catch (e) {
      this.logger.error("DeleteParamFamily error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "PARAM_FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "PARAM_FAMILY_CODE_IN_USE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_PARAM_FAMILY_ERR",
          e.toString(),
          "Delete param family failed"
        );
      }
    }
  };

  IsParamFamilyCodeAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .nonempty({ message: "Param Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),
      });
      let { paramfamilycode } = validateAllInputs(schema, {
        paramfamilycode: req.params.paramfamilycode,
      });

      let result =
        await this.modelHdlrImpl.IsParamFamilyCodeAvailableLogic(
          paramfamilycode
        );
      APIResponseOK(
        req,
        res,
        result,
        "Param family code availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsParamFamilyCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_PARAM_FAMILY_CODE_AVAILABLE_ERR",
          e.toString(),
          "Check param family code availability failed"
        );
      }
    }
  };

  // parameter CRUD
  CreateModelParam = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create model param."
        );
      }
      let schema = z.object({
        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          })
          .optional(),
        paramcode: z
          .string({ message: "Invalid Param Code format" })
          .nonempty({ message: "Param Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Param Code must be at most 128 characters" }),

        paramname: z
          .string({ message: "Invalid Param Name format" })
          .nonempty({ message: "Param Name cannot be empty" })
          .max(128, {
            message: "Param Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),

        paraminfo: z.record(z.any()).optional(),
      });

      const { paramfamilycode, paramcode, paramname, paraminfo } =
        validateAllInputs(schema, {
          paramfamilycode: req.body.paramfamilycode,
          paramcode: req.body.paramcode,
          paramname: req.body.paramname,
          paraminfo: req.body.paraminfo,
        });

      let createdby = req.userid;
      let isenabled = true;

      let result = await this.modelHdlrImpl.CreateModelParamLogic(
        paramfamilycode,
        paramcode,
        paramname,
        paraminfo || {},
        isenabled,
        createdby
      );

      APIResponseOK(req, res, result, "Model parameter created successfully");
    } catch (e) {
      this.logger.error("CreateModelParam error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "PARAM_CODE_ALREADY_EXISTS" ||
        e.errcode === "PARAM_FAMILY_CODE_NOT_FOUND"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_MODEL_PARAM_ERR",
          e.toString(),
          "Create model parameter failed"
        );
      }
    }
  };

  ListModelParams = async (req, res, next) => {
    try {
      let result = await this.modelHdlrImpl.ListModelParamsLogic();
      APIResponseOK(req, res, result, "Model parameters fetched successfully");
    } catch (e) {
      this.logger.error("ListModelParams error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_MODEL_PARAMS_ERR",
        e.toString(),
        "List model parameters failed"
      );
    }
  };

  ListModelParamsByFamily = async (req, res, next) => {
    try {
      let schema = z.object({
        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .nonempty({ message: "Param Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),
      });

      let { paramfamilycode } = validateAllInputs(schema, {
        paramfamilycode: req.params.paramfamilycode,
      });

      let result =
        await this.modelHdlrImpl.ListModelParamsByFamilyLogic(paramfamilycode);
      APIResponseOK(req, res, result, "Model parameters fetched successfully");
    } catch (e) {
      this.logger.error("ListModelParamsByFamily error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "LIST_MODEL_PARAMS_BY_FAMILY_ERR",
          e.toString(),
          "List model parameters by family failed"
        );
      }
    }
  };

  UpdateModelParam = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update model param."
        );
      }
      let schema = z.object({
        paramfamilycode: z
          .string({ message: "Param Family Code is required" })
          .nonempty({ message: "Param Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),

        paramcode: z
          .string({ message: "Param Code is required" })
          .nonempty({ message: "Param Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Param Code must be at most 128 characters" }),

        paramname: z
          .string({ message: "Invalid Param Name format" })
          .max(128, {
            message: "Param Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .optional(),
        paraminfo: z.record(z.any()).optional(),
        isenabled: z
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
      });

      let updatedby = req.userid;
      const { paramfamilycode, paramcode, ...updateFields } = validateAllInputs(
        schema,
        {
          paramfamilycode: req.params.paramfamilycode,
          paramcode: req.params.paramcode,
          ...req.body,
        }
      );

      let result = await this.modelHdlrImpl.UpdateModelParamLogic(
        paramfamilycode,
        paramcode,
        updateFields,
        updatedby
      );

      APIResponseOK(req, res, result, "Model parameter updated successfully");
    } catch (e) {
      this.logger.error("UpdateModelParam error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "PARAM_CODE_NOT_FOUND") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_MODEL_PARAM_ERR",
          e.toString(),
          "Update model parameter failed"
        );
      }
    }
  };

  DeleteModelParam = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete model param."
        );
      }
      let schema = z.object({
        paramfamilycode: z
          .string({ message: "Param Family Code is required" })
          .nonempty({ message: "Param Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces ",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),
        paramcode: z
          .string({ message: "Param Code is required" })
          .nonempty({ message: "Param Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Param Code must be at most 128 characters" }),

        deletedby: z
          .string({ message: "DeletedBy is required" })
          .uuid({ message: "DeletedBy must be a valid UUID" }),
      });
      let { paramfamilycode, paramcode, deletedby } = validateAllInputs(
        schema,
        {
          paramfamilycode: req.params.paramfamilycode,
          paramcode: req.params.paramcode,
          deletedby: req.userid,
        }
      );
      let result = await this.modelHdlrImpl.DeleteModelParamLogic(
        paramfamilycode,
        paramcode,
        deletedby
      );
      APIResponseOK(req, res, result, "Model parameter deleted successfully");
    } catch (e) {
      this.logger.error("DeleteModelParam error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "PARAM_CODE_NOT_FOUND" ||
        e.errcode === "PARAM_CODE_IN_USE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "DELETE_MODEL_PARAM_ERR",
          e.toString(),
          "Delete model parameter failed"
        );
      }
    }
  };

  IsParamCodeAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .nonempty({ message: "Param Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code must contain only letters, digits, underscores, hyphens, and spaces",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),

        paramcode: z
          .string({ message: "Invalid Param Code format" })
          .nonempty({ message: "Param Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Param Code must be at most 128 characters" }),
      });
      let { paramfamilycode, paramcode } = validateAllInputs(schema, {
        paramfamilycode: req.params.paramfamilycode,
        paramcode: req.params.paramcode,
      });
      let result = await this.modelHdlrImpl.IsParamCodeAvailableLogic(
        paramfamilycode,
        paramcode
      );
      APIResponseOK(
        req,
        res,
        result,
        "Model parameter code availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsParamCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "IS_PARAM_CODE_AVAILABLE_ERR",
          e.toString(),
          "Check model parameter code availability failed"
        );
      }
    }
  };

  // family CRUD
  CreateModelFamily = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create model family."
        );
      }
      let schema = z.object({
        createdby: z
          .string({ message: "Invalid User ID format" })
          .nonempty({ message: "User ID cannot be empty" })
          .uuid({ message: "User ID must be a valid UUID" }),

        familycode: z
          .string({ message: "Invalid Family Code format" })
          .nonempty({ message: "Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Family Code must be at most 128 characters" }),

        familyname: z
          .string({ message: "Invalid Family Name format" })
          .nonempty({ message: "Family Name cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family Name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Family Name must be at most 128 characters",
          }),

        familyinfo: z
          .record(z.any(), { message: "Family Info must be an object" })
          .optional(),
      });

      let { createdby, familycode, familyname, familyinfo } = validateAllInputs(
        schema,
        {
          createdby: req.userid,
          familycode: req.body.familycode,
          familyname: req.body.familyname,
          familyinfo: req.body.familyinfo,
        }
      );

      let isenabled = true;
      let result = await this.modelHdlrImpl.CreateModelFamilyLogic(
        familycode,
        familyname,
        familyinfo || {},
        isenabled,
        createdby
      );

      APIResponseOK(req, res, result, "Model family created successfully");
    } catch (e) {
      this.logger.error("CreateModelFamily error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "FAMILY_CODE_ALREADY_EXISTS") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_MODEL_FAMILY_ERR",
          e.toString(),
          "Create model family failed"
        );
      }
    }
  };

  ListModelFamilies = async (req, res, next) => {
    try {
      let result = await this.modelHdlrImpl.ListModelFamiliesLogic();
      APIResponseOK(req, res, result, "Model families fetched successfully");
    } catch (e) {
      this.logger.error("ListModelFamilies error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_MODEL_FAMILIES_ERR",
        e.toString(),
        "List model families failed"
      );
    }
  };

  UpdateModelFamily = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update model family."
        );
      }
      const schema = z.object({
        familycode: z
          .string({ message: "Invalid Model Family Code format" })
          .nonempty({ message: "Model Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Model Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Model Family Code must be at most 128 characters",
          }),

        familyname: z
          .string({ message: "Invalid Family Name format" })
          .max(128, {
            message: "Family Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family Name can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .optional(),
        modelfamilyinfo: z.object({
          chargestationtype: z
          .array(z.string())
          .min(1, { message: "Please select a charging station type" }),
          dosanddonts: z.string().optional(),
        }),

        isenabled: z.coerce
          .boolean({ message: "isenabled must be a boolean" })
          .optional(),
      });

      let updatedby = req.userid;

      const { familycode, familyname, modelfamilyinfo, isenabled } =
        validateAllInputs(schema, {
          familycode: req.params.familycode,
          ...req.body,
        });

      const updateFields = {
        ...(familyname !== undefined && { modelfamilyname: familyname }),
        ...(modelfamilyinfo !== undefined && { modelfamilyinfo }),
        ...(isenabled !== undefined && { isenabled }),
      };

      const result = await this.modelHdlrImpl.UpdateModelFamilyLogic(
        familycode,
        updateFields,
        updatedby
      );

      APIResponseOK(req, res, result, "Model family updated successfully");
    } catch (e) {
      this.logger.error("UpdateModelFamily error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (e.errcode === "FAMILY_CODE_NOT_FOUND") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_MODEL_FAMILY_ERR",
          e.toString(),
          "Update model family failed"
        );
      }
    }
  };

  DeleteModelFamily = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete model family."
        );
      }
      let schema = z.object({
        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "Invalid User ID format" }),
        familycode: z
          .string({ message: "Invalid Familycode format" })
          .nonempty({ message: "Invalid Family Code format" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Family code  must not exceed 128 characters" }),
      });
      let { deletedby, familycode } = validateAllInputs(schema, {
        deletedby: req.userid,
        familycode: req.params.familycode,
      });
      let result = await this.modelHdlrImpl.DeleteModelFamilyLogic(
        familycode,
        deletedby
      );
      APIResponseOK(req, res, result, "Model family deleted successfully");
    } catch (e) {
      this.logger.error("DeleteModelFamily error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "FAMILY_CODE_IN_USE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "DELETE_MODEL_FAMILY_ERR",
          e.toString(),
          "Delete model family failed"
        );
      }
    }
  };

  IsFamilyCodeAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        familycode: z
          .string({ message: "Invalid Family Code format" })
          .nonempty({ message: "Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Family Code must be at most 128 characters" }),
      });

      let { familycode } = validateAllInputs(schema, {
        familycode: req.params.familycode,
      });

      let result =
        await this.modelHdlrImpl.IsFamilyCodeAvailableLogic(familycode);

      APIResponseOK(
        req,
        res,
        result,
        "Model family code availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsFamilyCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "IS_FAMILY_CODE_AVAILABLE_ERR",
          e.toString(),
          "Check model family code availability failed"
        );
      }
    }
  };

  CreateModelFamilyParam = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create model family param."
        );
      }
      let schema = z.object({
        createdby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        familycode: z
          .string({ message: "Invalid Family Code format" })
          .nonempty({ message: "Family code is required" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Family code must be at most 128 characters" }),

        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .nonempty({ message: "Param family code is required" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),

        params: z
          .array(
            z.object({
              paramcode: z
                .string({ message: "Invalid Param Code format" })
                .nonempty({ message: "Param Code cannot be empty" })
                .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
                  message:
                    "Param Code can only contain letters, numbers, spaces, hyphens, and underscores",
                }),
              paramvalue: z
                .any()
                .refine((val) => val !== undefined && val !== null, {
                  message: "Param value cannot be undefined or null",
                }),
            })
          )
          .optional()
          .default([]),
      });

      let { createdby, familycode, paramfamilycode, params } =
        validateAllInputs(schema, {
          createdby: req.userid,
          familycode: req.body.familycode,
          paramfamilycode: req.body.paramfamilycode,
          params: req.body.params,
        });

      // Handle empty params array - delete all parameters for this familycode and paramfamilycode
      if (params.length === 0) {
        try {
          // Get existing parameters to delete them
          let existingParams =
            await this.modelHdlrImpl.ListModelFamilyParamsLogic(
              familycode,
              paramfamilycode
            );

          let deleteResults = [];
          if (existingParams && existingParams.length > 0) {
            // Delete each existing parameter
            for (const existingParam of existingParams) {
              try {
                let deleteResult =
                  await this.modelHdlrImpl.DeleteModelFamilyParamLogic(
                    familycode,
                    paramfamilycode,
                    existingParam.paramcode,
                    createdby
                  );
                deleteResults.push({
                  paramcode: existingParam.paramcode,
                  deleted: true,
                  result: deleteResult,
                });
              } catch (deleteErr) {
                this.logger.error(
                  `Failed to delete parameter ${
                    existingParam.paramcode
                  }: ${deleteErr.toString()}`
                );
                deleteResults.push({
                  paramcode: existingParam.paramcode,
                  deleted: false,
                  error: deleteErr.toString(),
                });
              }
            }
          }

          let result = {
            action: "delete_all",
            familycode: familycode,
            paramfamilycode: paramfamilycode,
            deletedcount: deleteResults.filter((r) => r.deleted).length,
            failedcount: deleteResults.filter((r) => !r.deleted).length,
            totalfound: existingParams ? existingParams.length : 0,
            details: deleteResults,
          };

          APIResponseOK(
            req,
            res,
            result,
            "All model family parameters deleted successfully"
          );
          return;
        } catch (e) {
          APIResponseInternalErr(
            req,
            res,
            "DELETE_ALL_MODEL_FAMILY_PARAMS_ERR",
            e.toString(),
            "Delete all model family parameters failed"
          );
          return;
        }
      }

      // Filter out duplicates based on paramcode
      const uniqueParams = [];
      const seenParamCodes = new Set();

      for (const param of params) {
        if (!seenParamCodes.has(param.paramcode)) {
          seenParamCodes.add(param.paramcode);
          uniqueParams.push(param);
        } else {
          this.logger.error(
            `Duplicate paramcode found and filtered: ${param.paramcode}`
          );
        }
      }

      // Check if we have any parameters left after filtering
      if (uniqueParams.length === 0) {
        APIResponseBadRequest(
          req,
          res,
          "NO_UNIQUE_PARAMS",
          "No unique parameters found after removing duplicates"
        );
        return;
      }

      // Log the filtering results
      if (uniqueParams.length !== params.length) {
        this.logger.error(
          `Filtered ${
            params.length - uniqueParams.length
          } duplicate parameters. Original: ${params.length}, Unique: ${
            uniqueParams.length
          }`
        );
      }

      let result = await this.modelHdlrImpl.CreateModelFamilyParamsLogic(
        familycode,
        paramfamilycode,
        uniqueParams,
        createdby
      );

      // Add filtering info to response if duplicates were found
      if (uniqueParams.length !== params.length) {
        result.duplicatesfiltered = params.length - uniqueParams.length;
        result.originalcount = params.length;
        result.uniquecount = uniqueParams.length;
      }

      APIResponseOK(
        req,
        res,
        result,
        "Model family parameters updated successfully"
      );
    } catch (e) {
      this.logger.error("CreateModelFamilyParam error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "PARAM_FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "PARAM_CODE_NOT_FOUND"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_MODEL_FAMILY_PARAMS_ERR",
          e.toString(),
          "Create model family parameters failed"
        );
      }
    }
  };

  ListModelFamilyParams = async (req, res, next) => {
    try {
      let schema = z.object({
        familycode: z
          .string({ message: "Invalid Family Code format" })
          .nonempty({ message: "Family code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Family code must not exceed 128 characters" }),

        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .nonempty({ message: "Param family code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param family code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Param family code must not exceed 128 characters",
          }),
      });
      let { familycode, paramfamilycode } = validateAllInputs(schema, {
        familycode: req.params.familycode,
        paramfamilycode: req.params.paramfamilycode,
      });
      let result = await this.modelHdlrImpl.ListModelFamilyParamsLogic(
        familycode,
        paramfamilycode
      );
      APIResponseOK(
        req,
        res,
        result,
        "Model family parameters fetched successfully"
      );
    } catch (e) {
      this.logger.error("ListModelFamilyParams error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "LIST_MODEL_FAMILY_PARAMS_ERR",
          e.toString(),
          "List model family parameters failed"
        );
      }
    }
  };

  DeleteModelFamilyParam = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete model family param."
        );
      }
      let schema = z.object({
        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),

        familycode: z
          .string({ message: "Invalid Family Code format" })
          .nonempty({ message: "Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Family Code must be at most 128 characters" }),

        paramfamilycode: z
          .string({ message: "Invalid Param Family Code format" })
          .nonempty({ message: "Param Family Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Param Family Code must be at most 128 characters",
          }),

        paramcode: z
          .string({ message: "Invalid Param Code format" })
          .nonempty({ message: "Param Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Param Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Param Code must be at most 128 characters" }),
      });

      let { deletedby, familycode, paramfamilycode, paramcode } =
        validateAllInputs(schema, {
          deletedby: req.userid,
          familycode: req.params.familycode,
          paramfamilycode: req.params.paramfamilycode,
          paramcode: req.params.paramcode,
        });

      let result = await this.modelHdlrImpl.DeleteModelFamilyParamLogic(
        familycode,
        paramfamilycode,
        paramcode,
        deletedby
      );
      APIResponseOK(
        req,
        res,
        result,
        "Model family parameter deleted successfully"
      );
    } catch (e) {
      this.logger.error("DeleteModelFamilyParam error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "PARAM_FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "PARAM_CODE_NOT_FOUND"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_MODEL_FAMILY_PARAM_ERR",
          e.toString(),
          "Delete model family parameter failed"
        );
      }
    }
  };

  // vehicle model CRUD
  CreateVehicleModel = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create vehicle model."
        );
      }
      const schema = z
        .object({
          modelcode: z
            .string({ message: "Invalid Model Code format" })
            .nonempty({ message: "Model Code cannot be empty" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Code can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .max(128, { message: "Model Code must be at most 128 characters" }),

          modelname: z
            .string({ message: "Invalid Model Name format" })
            .max(128, {
              message: "Model Name must be at most 128 characters",
            })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Name can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .optional(),

          modelvariant: z
            .string({ message: "Invalid Model Variant format" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Variant can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .max(128, {
              message: "Model Variant must be at most 128 characters",
            })
            .optional(),

          modelfamilycode: z
            .string({ message: "Invalid Model Family Code format" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .max(128, {
              message: "Model Family Code must be at most 128 characters",
            })
            .optional(),

          modeldisplayname: z
            .string({ message: "Invalid Model Display Name format" })
            .max(128, {
              message: "Model Display Name must be at most 128 characters",
            })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Display Name can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .optional(),

          modelinfo: z
            .object({
              modelimage: z
                .string({ message: "Invalid ModelImage url format" })
                .max(255, {
                  message: "ModelImage must be at most 255 characters",
                })
                .regex(
                  /^(https?:\/\/([a-z0-9\-]+)\.([a-z0-9\-]+)\.([a-z]+).*)?$/i,
                  { message: "Invalid ModelImage URL format" }
                )
                .optional(),

              modelicon: z
                .string({ message: "Invalid ModelIcon url format" })
                .max(255, {
                  message: "ModelIcon must be at most 255 characters",
                })
                .regex(
                  /^(https?:\/\/([a-z0-9\-]+)\.([a-z0-9\-]+)\.([a-z]+).*)?$/i,
                  { message: "Invalid ModelIcon URL format" }
                )
                .optional(),

              modelmanual: z
                .string({ message: "Invalid ModelManual url format" })
                .max(255, {
                  message: "ModelManual must be at most 255 characters",
                })
                .regex(
                  /^(https?:\/\/([a-z0-9\-]+)\.([a-z0-9\-]+)\.([a-z]+).*)?$/i,
                  { message: "Invalid ModelManual URL format" }
                )
                .optional(),
            })
            .strict()
            .optional(),

          isenabled: z
            .boolean({ message: "isenabled must be a boolean" })
            .optional(),
        })
        .refine(
          (data) =>
            data.modelname ||
            data.modelvariant ||
            data.modelfamilycode ||
            data.modeldisplayname ||
            data.modelinfo ||
            typeof data.isenabled !== "undefined",
          {
            message: "At least one field must be provided",
            path: [],
          }
        );
      let createdby = req.userid;

      const {
        modelcode,
        modelname,
        modelvariant,
        modelfamilycode,
        modeldisplayname,
        modelinfo,
        isenabled,
      } = validateAllInputs(schema, {
        modelcode: req.body.modelcode,
        modelname: req.body.modelname,
        modelvariant: req.body.modelvariant,
        modelfamilycode: req.body.modelfamilycode,
        modeldisplayname: req.body.modeldisplayname,
        modelinfo: req.body.modelinfo,
        isenabled: req.body.isenabled,
      });

      const result = await this.modelHdlrImpl.CreateVehicleModelLogic(
        modelcode,
        modelname,
        modelvariant,
        modelfamilycode,
        modeldisplayname,
        modelinfo || {},
        isenabled !== undefined ? isenabled : true,
        createdby
      );

      APIResponseOK(req, res, result, "Vehicle model created successfully");
    } catch (e) {
      this.logger.error("CreateVehicleModel error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "MODEL_CODE_ALREADY_EXISTS" ||
        e.errcode === "FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "MODEL_NAME_VARIANT_ALREADY_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_VEHICLE_MODEL_ERR",
          e.toString(),
          "Create vehicle model failed"
        );
      }
    }
  };

  ListVehicleModels = async (req, res, next) => {
    try {
      let result = await this.modelHdlrImpl.ListVehicleModelsLogic();
      APIResponseOK(req, res, result, "Vehicle models fetched successfully");
    } catch (e) {
      this.logger.error("ListVehicleModels error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_VEHICLE_MODELS_ERR",
        e.toString(),
        "List vehicle models failed"
      );
    }
  };

  UpdateVehicleModel = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update vehicle model."
        );
      }
      let schema = z
        .object({
          modelcode: z
            .string({ message: "Invalid Model Code format" })
            .nonempty({ message: "Model Code cannot be empty" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Code can only contain letters, numbers, spaces, hyphens, and underscores",
            }),

          modelname: z
            .string({ message: "Invalid Model Name format" })
            .max(128, {
              message: "Model Name must be at most 128 characters",
            })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Name can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .optional(),

          modelvariant: z
            .string({ message: "Invalid Model Variant format" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Variant can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .max(128, {
              message: "Model Variant must be at most 128 characters",
            })
            .optional(),

          modelfamilycode: z
            .string({ message: "Invalid Model Family Code format" })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Family Code can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .max(128, {
              message: "Model Family Code must be at most 128 characters",
            })
            .optional(),

          modeldisplayname: z
            .string({ message: "Invalid Model Display Name format" })
            .max(128, {
              message: "Model Display Name must be at most 128 characters",
            })
            .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
              message:
                "Model Display Name can only contain letters, numbers, spaces, hyphens, and underscores",
            })
            .optional(),

          modelinfo: z
            .object({
              modelimage: z
                .string({ message: "Invalid ModelImage url format" })
                .max(255, {
                  message: "ModelImage must be at most 255 characters",
                })
                .regex(
                  /^(https?:\/\/([a-z0-9\-]+)\.([a-z0-9\-]+)\.([a-z]+).*)?$/i,
                  { message: "Invalid Modelimage URL format" }
                )
                .optional(),

              modelicon: z
                .string({ message: "Invalid ModelIcon url format" })
                .max(255, {
                  message: "ModelIcon must be at most 255 characters",
                })
                .regex(
                  /^(https?:\/\/([a-z0-9\-]+)\.([a-z0-9\-]+)\.([a-z]+).*)?$/i,
                  { message: "Invalid ModelIcon URL format" }
                )
                .optional(),

              modelmanual: z
                .string({ message: "Invalid ModelManual url format" })
                .max(255, {
                  message: "modelManual must be at most 255 characters",
                })
                .regex(
                  /^(https?:\/\/([a-z0-9\-]+)\.([a-z0-9\-]+)\.([a-z]+).*)?$/i,
                  { message: "Invalid ModelManual URL format" }
                )
                .optional(),
              brochurespecs: z
                .object({
                  range: z.string().optional(),
                  battery_capacity: z.string().optional(),
                  co2_emission_factor: z.string().optional(),
                  fuel_price_factor: z.string().optional(),
                })
                .optional(),
            })
            .strict()
            .optional(),

          isenabled: z
            .boolean({ message: "isenabled must be a boolean" })
            .optional(),
        })
        .refine(
          (data) =>
            data.modelname ||
            data.modelvariant ||
            data.modelfamilycode ||
            data.modeldisplayname ||
            data.modelinfo ||
            typeof data.isenabled !== "undefined",
          {
            message: "At least one field must be provided for update",
            path: [],
          }
        );
      let updatedby = req.userid;
      let { modelcode, ...updateFields } = validateAllInputs(schema, {
        modelcode: req.params.modelcode,
        ...req.body,
      });

      let result = await this.modelHdlrImpl.UpdateVehicleModelLogic(
        modelcode,
        updateFields,
        updatedby
      );

      APIResponseOK(req, res, result, "Vehicle model updated successfully");
    } catch (e) {
      this.logger.error("UpdateVehicleModel error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "MODEL_CODE_NOT_FOUND" ||
        e.errcode === "FAMILY_CODE_NOT_FOUND" ||
        e.errcode === "MODEL_NAME_VARIANT_ALREADY_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_VEHICLE_MODEL_ERR",
          e.toString(),
          "Update vehicle model failed"
        );
      }
    }
  };

  DeleteVehicleModel = async (req, res, next) => {
    try {
      if (!CheckUserPerms(req.userperms, ["consolemgmt.model.admin"])) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete vehicle model."
        );
      }
      let schema = z.object({
        deletedby: z
          .string({ message: "Invalid User ID format" })
          .uuid({ message: "User ID must be a valid UUID" }),
        modelcode: z
          .string({ message: "Invalid Model Code format" })
          .nonempty({ message: "Model Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Model Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Model Code must be at most 128 characters" }),
      });

      let { deletedby, modelcode } = validateAllInputs(schema, {
        deletedby: req.userid,
        modelcode: req.params.modelcode,
      });
      let result = await this.modelHdlrImpl.DeleteVehicleModelLogic(
        modelcode,
        deletedby
      );
      APIResponseOK(req, res, result, "Vehicle model deleted successfully");
    } catch (e) {
      this.logger.error("DeleteVehicleModel error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "MODEL_CODE_NOT_FOUND" ||
        e.errcode === "MODEL_CODE_IN_USE"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_VEHICLE_MODEL_ERR",
          e.toString(),
          "Delete vehicle model failed"
        );
      }
    }
  };

  IsModelCodeAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        modelcode: z
          .string({ message: "Invalid Model Code format" })
          .nonempty({ message: "Model Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Model Code can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, { message: "Model Code must be at most 128 characters" }),
      });

      let { modelcode } = validateAllInputs(schema, {
        modelcode: req.params.modelcode,
      });
      let result =
        await this.modelHdlrImpl.IsModelCodeAvailableLogic(modelcode);
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle model code availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsModelCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_MODEL_CODE_AVAILABLE_ERR",
          e.toString(),
          "Check vehicle model code availability failed"
        );
      }
    }
  };

  IsModelNameVariantAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        modelname: z
          .string({ message: "Invalid Model Name format" })
          .nonempty({ message: "Model Name cannot be empty" })
          .max(128, { message: "Model Name must be at most 128 characters" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Model Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
        modelvariant: z
          .string({ message: "Invalid Model Variant format" })
          .nonempty({ message: "Model Variant cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Model Variant can only contain letters, numbers, spaces, hyphens, and underscores",
          })
          .max(128, {
            message: "Model Variant must be at most 128 characters",
          }),
      });
      let { modelname, modelvariant } = validateAllInputs(schema, {
        modelname: req.params.modelname,
        modelvariant: req.params.modelvariant,
      });
      let result = await this.modelHdlrImpl.IsModelNameVariantAvailableLogic(
        modelname,
        modelvariant
      );
      APIResponseOK(
        req,
        res,
        result,
        "Vehicle model name and variant availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsModelNameVariantAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_MODEL_NAME_VARIANT_AVAILABLE_ERR",
          e.toString(),
          "Check vehicle model name and variant availability failed"
        );
      }
    }
  };

  GetAllModelsWithFamily = async (req, res, next) => {
    try {
      let result = await this.modelHdlrImpl.GetAllModelsWithFamilyLogic();
      APIResponseOK(
        req,
        res,
        result,
        "All models with family fetched successfully"
      );
    } catch (e) {
      this.logger.error("GetAllModelsWithFamily error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "GET_ALL_MODELS_WITH_FAMILY_ERR",
        e.toString(),
        "Get all models with family failed"
      );
    }
  };
}
