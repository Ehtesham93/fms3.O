import MetaHdlrImpl from "./metahdlr_impl.js";
import z from "zod";
import { validateAllInputs } from "../../../utils/validationutil.js";
import {
  APIResponseOK,
  APIResponseBadRequest,
  APIResponseInternalErr,
} from "../../../utils/responseutil.js";

export default class MetaHdlr {
  constructor(metaSvcI, logger) {
    this.metaSvcI = metaSvcI;
    this.logger = logger;
    this.metaHdlrImpl = new MetaHdlrImpl(metaSvcI, logger);
  }

  RegisterRoutes(router) {
    // vehicle city
    router.post("/city", this.CreateVehicleCity);
    router.get("/iscitycodeavailable/:citycode", this.IsCityCodeAvailable);
    router.get("/iscitynameavailable/:cityname", this.IsCityNameAvailable);
    router.put("/city/:citycode", this.UpdateVehicleCity);
    router.delete("/city/:citycode", this.DeleteVehicleCity);

    // vehicle dealer
    router.post("/dealer", this.CreateVehicleDealer);
    router.get(
      "/isdealercodeavailable/:dealercode",
      this.IsDealerCodeAvailable
    );
    router.get("/isdealernameavailable/:dealername", this.IsDealerNameAvailable);
    router.put("/dealer/:dealercode", this.UpdateVehicleDealer);
    router.delete("/dealer/:dealercode", this.DeleteVehicleDealer);

    // vehicle color
    router.post("/color", this.CreateVehicleColor);
    router.get("/iscolorcodeavailable/:colorcode", this.IsColorCodeAvailable);
    router.get("/iscolornameavailable/:colorname", this.IsColorNameAvailable);
    router.put("/color/:colorcode", this.UpdateVehicleColor);
    router.delete("/color/:colorcode", this.DeleteVehicleColor);
  }

  // vehicle city
  CreateVehicleCity = async (req, res, next) => {
    try {
      const schema = z.object({
        cityname: z
          .string({ message: "Invalid City Name format" })
          .nonempty({ message: "City Name cannot be empty" })
          .max(128, {
            message: "City Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "City Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });

      const { cityname } = validateAllInputs(schema, {
        cityname: req.body.cityname,
      });

      const result = await this.metaHdlrImpl.CreateVehicleCityLogic(
        cityname
      );

      APIResponseOK(req, res, result, "Vehicle city created successfully");
    } catch (e) {
      this.logger.error("CreateVehicleCity error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "CITY_CODE_ALREADY_EXISTS" ||
        e.errcode === "CITY_NAME_ALREADY_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_VEHICLE_CITY_ERR",
          e.toString(),
          "Create vehicle city failed"
        );
      }
    }
  };

  IsCityCodeAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        citycode: z
          .string({ message: "Invalid City Code format" })
          .nonempty({ message: "City Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "City Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "City Code must be at most 128 characters",
          }),
      });
      let { citycode } = validateAllInputs(schema, {
        citycode: req.params.citycode,
      });

      let result = await this.metaHdlrImpl.IsCityCodeAvailableLogic(citycode);
      APIResponseOK(
        req,
        res,
        result,
        "City code availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsCityCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_CITY_CODE_AVAILABLE_ERR",
          e.toString(),
          "Check city code availability failed"
        );
      }
    }
  };

  IsCityNameAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        cityname: z
          .string({ message: "Invalid City Name format" })
          .nonempty({ message: "City Name cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "City Name must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "City Name must be at most 128 characters",
          }),
      });
      let { cityname } = validateAllInputs(schema, {
        cityname: req.params.cityname,
      });

      let result = await this.metaHdlrImpl.IsCityNameAvailableLogic(cityname);
      APIResponseOK(
        req,
        res,
        result,
        "City name availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsCityNameAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_CITY_NAME_AVAILABLE_ERR",
          e.toString(),
          "Check city name availability failed"
        );
      }
    }
  };

  UpdateVehicleCity = async (req, res, next) => {
    try {
      const schema = z.object({
        citycode: z
          .string({ message: "Invalid City Code format" })
          .nonempty({ message: "City Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "City Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "City Code must be at most 128 characters",
          }),
        cityname: z
          .string({ message: "Invalid City Name format" })
          .nonempty({ message: "City Name cannot be empty" })
          .max(128, {
            message: "City Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "City Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });
      const { citycode, cityname } = validateAllInputs(schema, {
        citycode: req.params.citycode,
        cityname: req.body.cityname,
      });

      const result = await this.metaHdlrImpl.UpdateVehicleCityLogic(citycode, cityname);
      APIResponseOK(req, res, result, "Vehicle city updated successfully");
    } catch (e) {
      this.logger.error("UpdateVehicleCity error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_VEHICLE_CITY_ERR",
          e.toString(),
          "Update vehicle city failed"
        );
      }
    }
  };

  DeleteVehicleCity = async (req, res, next) => {
    try {
      const schema = z.object({
        citycode: z
          .string({ message: "Invalid City Code format" })
          .nonempty({ message: "City Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "City Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "City Code must be at most 128 characters",
          }),
      });
      const { citycode } = validateAllInputs(schema, {
        citycode: req.params.citycode
      });

      const result = await this.metaHdlrImpl.DeleteVehicleCityLogic(citycode);
      APIResponseOK(req, res, result, "Vehicle city deleted successfully");
    } catch (e) {
      this.logger.error("DeleteVehicleCity error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_VEHICLE_CITY_ERR",
          e.toString(),
          "Delete vehicle city failed"
        );
      }
    }
  };

  // ===== VEHICLE DEALER CRUD =====
  CreateVehicleDealer = async (req, res, next) => {
    try {
      const schema = z.object({
        dealername: z
          .string({ message: "Invalid Dealer Name format" })
          .nonempty({ message: "Dealer Name cannot be empty" })
          .max(128, {
            message: "Dealer Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Dealer Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });

      const { dealername } = validateAllInputs(schema, {
        dealername: req.body.dealername,
      });

      const result = await this.metaHdlrImpl.CreateVehicleDealerLogic(
        dealername
      );

      APIResponseOK(req, res, result, "Vehicle dealer created successfully");
    } catch (e) {
      this.logger.error("CreateVehicleDealer error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "DEALER_CODE_ALREADY_EXISTS" ||
        e.errcode === "DEALER_NAME_ALREADY_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_VEHICLE_DEALER_ERR",
          e.toString(),
          "Create vehicle dealer failed"
        );
      }
    }
  };

  IsDealerCodeAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        dealercode: z
          .string({ message: "Invalid Dealer Code format" })
          .nonempty({ message: "Dealer Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Dealer Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Dealer Code must be at most 128 characters",
          }),
      });
      let { dealercode } = validateAllInputs(schema, {
        dealercode: req.params.dealercode,
      });

      let result = await this.metaHdlrImpl.IsDealerCodeAvailableLogic(
        dealercode
      );
      APIResponseOK(
        req,
        res,
        result,
        "Dealer code availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsDealerCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_DEALER_CODE_AVAILABLE_ERR",
          e.toString(),
          "Check dealer code availability failed"
        );
      }
    }
  };

  IsDealerNameAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        dealername: z
          .string({ message: "Invalid Dealer Name format" })
          .nonempty({ message: "Dealer Name cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Dealer Name must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Dealer Name must be at most 128 characters",
          }),
      });
      let { dealername } = validateAllInputs(schema, {
        dealername: req.params.dealername,
      });

      let result = await this.metaHdlrImpl.IsDealerNameAvailableLogic(
        dealername
      );
      APIResponseOK(
        req,
        res,
        result,
        "Dealer name availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsDealerNameAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_DEALER_NAME_AVAILABLE_ERR",
          e.toString(),
          "Check dealer name availability failed"
        );
      }
    }
  };

  UpdateVehicleDealer = async (req, res, next) => {
    try {
      const schema = z.object({
        dealercode: z
          .string({ message: "Invalid Dealer Code format" })
          .nonempty({ message: "Dealer Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Dealer Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Dealer Code must be at most 128 characters",
          }),
        dealername: z
          .string({ message: "Invalid Dealer Name format" })
          .nonempty({ message: "Dealer Name cannot be empty" })
          .max(128, {
            message: "Dealer Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Dealer Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });
      const { dealercode, dealername } = validateAllInputs(schema, {
        dealercode: req.params.dealercode,
        dealername: req.body.dealername,
      });

      const result = await this.metaHdlrImpl.UpdateVehicleDealerLogic(dealercode, dealername);
      APIResponseOK(req, res, result, "Vehicle dealer updated successfully");
    } catch (e) {
      this.logger.error("UpdateVehicleDealer error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_VEHICLE_DEALER_ERR",
          e.toString(),
          "Update vehicle dealer failed"
        );
      }
    }
  };

  DeleteVehicleDealer = async (req, res, next) => {
    try {
      const schema = z.object({
        dealercode: z
          .string({ message: "Invalid Dealer Code format" })
          .nonempty({ message: "Dealer Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Dealer Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Dealer Code must be at most 128 characters",
          }),
      });
      const { dealercode } = validateAllInputs(schema, {
        dealercode: req.params.dealercode
      });

      const result = await this.metaHdlrImpl.DeleteVehicleDealerLogic(dealercode);
      APIResponseOK(req, res, result, "Vehicle dealer deleted successfully");
    } catch (e) {
      this.logger.error("DeleteVehicleDealer error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_VEHICLE_DEALER_ERR",
          e.toString(),
          "Delete vehicle dealer failed"
        );
      }
    }
  };

  // ===== VEHICLE COLOR CRUD =====
  CreateVehicleColor = async (req, res, next) => {
    try {
      const schema = z.object({
        colorname: z
          .string({ message: "Invalid Color Name format" })
          .nonempty({ message: "Color Name cannot be empty" })
          .max(128, {
            message: "Color Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Color Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });

      const { colorname } = validateAllInputs(schema, {
        colorname: req.body.colorname,
      });

      const result = await this.metaHdlrImpl.CreateVehicleColorLogic(
        colorname
      );

      APIResponseOK(req, res, result, "Vehicle color created successfully");
    } catch (e) {
      this.logger.error("CreateVehicleColor error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else if (
        e.errcode === "COLOR_CODE_ALREADY_EXISTS" ||
        e.errcode === "COLOR_NAME_ALREADY_EXISTS"
      ) {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "CREATE_VEHICLE_COLOR_ERR",
          e.toString(),
          "Create vehicle color failed"
        );
      }
    }
  };

  IsColorCodeAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        colorcode: z
          .string({ message: "Invalid Color Code format" })
          .nonempty({ message: "Color Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Color Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Color Code must be at most 128 characters",
          }),
      });
      let { colorcode } = validateAllInputs(schema, {
        colorcode: req.params.colorcode,
      });

      let result = await this.metaHdlrImpl.IsColorCodeAvailableLogic(colorcode);
      APIResponseOK(
        req,
        res,
        result,
        "Color code availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsColorCodeAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_COLOR_CODE_AVAILABLE_ERR",
          e.toString(),
          "Check color code availability failed"
        );
      }
    }
  };

  IsColorNameAvailable = async (req, res, next) => {
    try {
      let schema = z.object({
        colorname: z
          .string({ message: "Invalid Color Name format" })
          .nonempty({ message: "Color Name cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Color Name must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Color Name must be at most 128 characters",
          }),
      });
      let { colorname } = validateAllInputs(schema, {
        colorname: req.params.colorname,
      });

      let result = await this.metaHdlrImpl.IsColorNameAvailableLogic(colorname);
      APIResponseOK(
        req,
        res,
        result,
        "Color name availability checked successfully"
      );
    } catch (e) {
      this.logger.error("IsColorNameAvailable error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "IS_COLOR_NAME_AVAILABLE_ERR",
          e.toString(),
          "Check color name availability failed"
        );
      }
    }
  };

  UpdateVehicleColor = async (req, res, next) => {
    try {
      const schema = z.object({
        colorcode: z
          .string({ message: "Invalid Color Code format" })
          .nonempty({ message: "Color Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Color Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Color Code must be at most 128 characters",
          }),
        colorname: z
          .string({ message: "Invalid Color Name format" })
          .nonempty({ message: "Color Name cannot be empty" })
          .max(128, {
            message: "Color Name must be at most 128 characters",
          })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Color Name can only contain letters, numbers, spaces, hyphens, and underscores",
          }),
      });
      const { colorcode, colorname } = validateAllInputs(schema, {
        colorcode: req.params.colorcode,
        colorname: req.body.colorname,
      });

      const result = await this.metaHdlrImpl.UpdateVehicleColorLogic(colorcode, colorname);
      APIResponseOK(req, res, result, "Vehicle color updated successfully");
    } catch (e) {
      this.logger.error("UpdateVehicleColor error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "UPDATE_VEHICLE_COLOR_ERR",
          e.toString(),
          "Update vehicle color failed"
        );
      }
    }
  };

  DeleteVehicleColor = async (req, res, next) => {
    try {
      const schema = z.object({
        colorcode: z
          .string({ message: "Invalid Color Code format" })
          .nonempty({ message: "Color Code cannot be empty" })
          .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/, {
            message:
              "Color Code must contain only letters, digits, underscores, hyphens, and spaces (no leading/trailing space)",
          })
          .max(128, {
            message: "Color Code must be at most 128 characters",
          }),
      });
      const { colorcode } = validateAllInputs(schema, {
        colorcode: req.params.colorcode
      });

      const result = await this.metaHdlrImpl.DeleteVehicleColorLogic(colorcode);
      APIResponseOK(req, res, result, "Vehicle color deleted successfully");
    } catch (e) {
      this.logger.error("DeleteVehicleColor error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        return APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        return APIResponseInternalErr(
          req,
          res,
          "DELETE_VEHICLE_COLOR_ERR",
          e.toString(),
          "Delete vehicle color failed"
        );
      }
    }
  };
}
