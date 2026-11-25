import crypto from "crypto";
import { UAParser } from "ua-parser-js";
import z from "zod";
import {
  UUID_PATTERN,
  CUSTOMER_TYPE_INDIVIDUAL,
  CUSTOMER_TYPE_CORPORATE,
} from "../../../utils/constant.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseError,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import DmsHdlrImpl from "./dmshdlr_impl.js";
import { parseQueryInt } from "../../../utils/commonutil.js";
import { preprocessingname } from "../../../utils/heuristicutil.js";

export default class DmsHdlr {
  constructor(
    dmsSvcI,
    platformSvcI,
    redisSvc,
    pUserHdlr,
    accountHdlr,
    vehicleHdlr,
    logger
  ) {
    this.dmsSvcI = dmsSvcI;
    this.platformSvcI = platformSvcI;
    this.redisSvc = redisSvc;
    this.logger = logger;
    this.pUserHdlr = pUserHdlr;
    this.accountHdlr = accountHdlr;
    this.vehicleHdlr = vehicleHdlr;
    this.dmsHdlrImpl = new DmsHdlrImpl(
      dmsSvcI,
      platformSvcI,
      redisSvc,
      pUserHdlr,
      accountHdlr,
      vehicleHdlr,
      logger
    );
  }

  checkDateValue = function (requestDate){
      if (!requestDate) return true; 
      const [day, month, year] = requestDate.split("/").map(Number);
      
      const inputDate = new Date(year, month - 1, day);
      
      const isValidCalendarDate = 
        inputDate.getFullYear() === year &&
        inputDate.getMonth() === month - 1 &&
        inputDate.getDate() === day;
        
      if (!isValidCalendarDate) return false;

      const today = new Date();
      today.setHours(23, 59, 59, 999); // Set to end of day to allow today's date
      
      return inputDate <= today;
    
  }

  RegisterRoutes(router) {
    router.put("/numberupdate-deletekyc", this.MobileUpdateDeleteKyc);
    router.post("/save-update-digitalkyc", this.SaveUpdateDigitalKyc);

    router.put("/consume-sold-vehicles", this.ConsumeSoldVehicles);
  }

  // Update Mobile Number & Delete KYC API
  MobileUpdateDeleteKyc = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.dms.api"
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update mobile number or delete kyc account."
        );
      }
      let baseSchema = z.object({
        userid: z
          .string({ message: "Invalid User ID " })
          .uuid({ message: "Invalid User ID " }),
        vinNumber: z
          .string({ message: "VIN Number must be a string" })
          .nonempty({ message: "VIN Number cannot be empty" })
          .min(17, { message: "VIN number must have 17 characters" })
          .refine((val) => /^(M)[a-zA-Z0-9]{16}$/.test(val), {
            message:
              "Invalid VIN number format. Must start with 'M'",
          }),
        mobileNumber : z
          .string({ message: "mobileNumber must be a string" })
          .nonempty({ message: "mobileNumber cannot be empty" })
          .min(9, { message: "mobileNumber must be atleast 9 digits" })
          .max(10, { message: "mobileNumber must be 10 digits" })
          .refine((val) => /^[6-9]\d{9}$/.test(val), {
            message:
              "Invalid nemo user mobile format. Must be 10 digits starting with 6-9.",
          }),
        oldMobileNumber: z
          .string({ message: "oldMobileNumber must be a string" })
          .min(9, { message: "oldMobileNumber must be atleast 9 digits" })
          .max(10, { message: "mobileNumber must be 10 digits" })
          .refine((val) => /^[6-9]\d{9}$/.test(val), {
            message:
              "Invalid nemo user mobile format. Must be 10 digits starting with 6-9.",
          })
          .optional()
          .nullable(),
        operationId: z
          .number({ message: "operationId must be a number" })
          .min(1, { message: "operationId must be atleast 1" })
          .max(2, { message: "operationId must be max of 2" })
          .optional()
          .nullable()
      });
      let schema = baseSchema.extend({
          wyhMobile: z
            .string({ message: "mobileNumber must be a string" })
            .optional()
            .nullable()
      });
      
      const {
        userid,
        vinNumber,
        mobileNumber,
        oldMobileNumber,
        operationId,
        wyhMobile
      } = validateAllInputs(schema, {
        userid: req.userid,
        vinNumber: req.body.vinNumber,
        mobileNumber: req.body.mobileNumber,
        oldMobileNumber: req.body.oldMobileNumber,
        operationId: req.body.operationId,
        wyhMobile: req.body.wyhMobile,
      });

      let result ;
      if(operationId == "1"){
        result = await this.pUserHdlr.pUserHdlrImpl.UpdateMobileNumberLogic(
          userid,
          vinNumber,
          mobileNumber,
          oldMobileNumber,
          operationId
        );
      } else if(operationId == "2"){
        result = await this.pUserHdlr.pUserHdlrImpl.DeleteKycLogic(
          userid,
          vinNumber,
          mobileNumber,
          operationId
        );
      }
      this.dmsSvcI.StoreDmsApiLogs(req.body,result,null);
      APIResponseOK(req, res, result, result.message);
    } catch (error) {
      this.dmsSvcI.StoreDmsApiLogs(req.body,null,error);
      this.logger.error("MobileUpdateDeleteKyc error: ", error);
      if (error.errcode === "CONSOLE_ACCESS_DENIED") {
        APIResponseForbidden(
          req,
          res,
          "USER_ACCOUNT_ACCESS_DENIED",
          null,
          error.message
        );
      } else if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message,
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "MOBILE_UPDATE_DELETE_KYC_ERR",
          error,
          "Mobile Update / Delete Kyc failed"
        );
      }
    }
  };

  SaveUpdateDigitalKyc = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.dms.api"
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to onboard perforom Save / update customer KYC details"
        );
      }
      let kycSchema = z.object({
          userid: z
            .string({ message: "Invalid User ID format" })
            .uuid({ message: "Invalid User ID format" }),
          vinNumber: z
            .string({ message: "VIN must be a string" })
            .nonempty({ message: "VIN cannot be empty" }),
          kycAgreement: z
            .string({ message: "KYC aggrement must be a string" })
            .nonempty({ message: "KYC aggrement cannot be empty" })
            .min(0, { message: "kycAgreement must be either 0 or 1" })
            .max(1, { message: "kycAgreement must be either 0 or 1" }),
          isUpdate: z
            .boolean({ message: "isUpdate is invalid" }),
          wyhMobile: z
            .string({ message: "Nemo user mobile must be a string" })
            .optional()
            .nullable()
            .refine((val) => /^[6-9]\d{9}$/.test(val), {
              message:
                "Invalid nemo user mobile format. Must be 10 digits starting with 6-9.",
            }),
          registrationNumber: z
            .string({ message: "License plate must be a string" })
            .optional()
            .nullable(),

          name: z
            .string({ message: "Customer name must be a string" })
            .nonempty({ message: "Customer name cannot be empty" }),
          mobileNumber: z
            .string({ message: "Customer contact mobile must be a string" })
            .nonempty({ message: "Customer contact mobile cannot be empty" })
            .min(10, { message: "Mobile number must be 10 digits" })
            .max(10, { message: "Mobile number must be 10 digits" })
            .refine((val) => /^[6-9]\d{9}$/.test(val), {
              message:
                "Invalid mobile number format. Must be 10 digits starting with 6-9.",
            }),
          email: z
            .string({ message: "Customer contact email must be a string" })
            .optional()
            .nullable(),
          adharNumber:  z
            .string({ message: "Customer contact email must be a string" })
            .optional()
            .nullable(),
          gender: z
            .string({ message: "Customer gender must be a string" })
            .optional()
            .nullable(),

          door: z
            .string({ message: "door must be a string" })
            .optional()
            .nullable(),
          streetName: z
            .string({ message: "door must be a string" })
            .optional()
            .nullable(),
          address1: z
            .string({ message: "Customer address must be a string" })
            .optional()
            .nullable(),
          address2: z
            .string({ message: "Customer address must be a string" })
            .optional()
            .nullable(),
          pinCode: z
            .string({ message: "Customer address pincode must be a string" })
            .optional()
            .nullable(),
          district: z
            .string({ message: "Customer address district must be a string" })
            .optional()
            .nullable(),
          state: z
            .string({ message: "Customer address state must be a string" })
            .optional()
            .nullable(),
      });
      
      if(req.body.vehicleModel && req.body.vehicleVariant) {
        // KYC Schema
        kycSchema = kycSchema.extend({
                vehicleModel: z
                  .string({ message: "Invalid Vehicle Model format" })
                  .nonempty({ message: "Vehicle Model cannot be empty" })
                  .regex(/^[A-Za-z0-9 _.+-]+$/, {
                    message: "Please enter a valid Vehicle Model",
                  }),
                vehicleVariant: z
                  .string({ message: "Invalid Vehicle Variant format" })
                  .nonempty({ message: "Vehicle Variant cannot be empty" }),
                vehicleColour: z.string().optional().nullable(),
                engineNo: z.string().optional().nullable(),
                dealer: z.string().optional().nullable(),
                deliveredDate: z.string().optional().nullable(),
                retailsSaleDate: z.string().optional().nullable(),
                vehicleCity: z.string().optional().nullable(),
            });
      }

      if(req.body.customerType) {
          kycSchema = kycSchema.extend({
              customerType: z
                        .string({ message: "Customer type must be a string" })
                        .optional(),
              corporateType: z
                        .string({ message: "Corporate type must be a string" })
                        .optional()
                        .nullable(),
              customerDateOfBirth: z
                        .string({ message: "Customer date of birth must be a string" })
                        .optional()
                        .nullable(),
              customerAddressCity: z
                        .string({ message: "Customer address city must be a string" })
                        .optional()
                        .nullable(),
              customerAddressCountry: z
                        .string({ message: "Customer address country must be a string" })
                        .optional()
                        .nullable(),
          });
      }

      const kycSchemaObject = validateAllInputs(kycSchema, {

        userid: req.userid,
        vinNumber: req.body.vinNumber,

        kycAgreement : req.body.kycAgreement,
        isUpdate : req.body.isUpdate,
        wyhMobile : req.body.wyhMobile,
        registrationNumber : req.body.registrationNumber,

        vehicleModel : req.body.vehicleModel,
        vehicleVariant : req.body.vehicleVariant,
        
        vehicleColour : req.body.vehicleColour,
        engineNo : req.body.engineNo,
        dealer : req.body.dealer,
        deliveredDate : req.body.deliveredDate,
        retailsSaleDate : req.body.retailsSaleDate,
        vehicleCity : req.body.vehicleCity,

        name: req.body.name,
        mobileNumber: req.body.mobileNumber,
        email: req.body.email,
        adharNumber: req.body.adharNumber,
        gender: req.body.gender,

        door: req.body.door,
        streetName: req.body.streetName, 
        address1: req.body.address1,
        address2: req.body.address2,
        pinCode: req.body.pinCode,
        district: req.body.district,
        state: req.body.state,

        customerType : req.body.customerType,
        corporateType : req.body.corporateType,
        customerDateOfBirth : req.body.customerDateOfBirth,
        customerAddressCity : req.body.customerAddressCity,
        customerAddressCountry : req.body.customerAddressCountry,

      });
      let result = await this.dmsHdlrImpl.ConsumeVehicleKycSchemaData(kycSchemaObject);
      this.dmsSvcI.StoreDmsApiLogs(req.body,result,null);
      APIResponseOK(req, res, result, result.message);
    } catch (error) {
      this.dmsSvcI.StoreDmsApiLogs(req.body,null,error);
      this.logger.error("SaveUpdateDigitalKyc error: ", error);
      if (error.errcode === "CONSOLE_ACCESS_DENIED") {
        APIResponseForbidden(
          req,
          res,
          "USER_ACCOUNT_ACCESS_DENIED",
          null,
          error.message
        );
      } else if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message,
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "SAVE_UPDATE_DIGITAL_KYC_ERR",
          error,
          "Save / Update Digital Kyc API failed"
        );
      }
    }
  };

  ConsumeSoldVehicles = async (req, res, next) => {
    try {
      if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.dms.api",
          "consolemgmt.user.admin",
          "consolemgmt.account.admin",
          "consolemgmt.vehicle.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update mobile number or delete kyc account."
        );
      }
      let schema = z.object({
        userid: z
          .string({ message: "Invalid User ID " })
          .uuid({ message: "Invalid User ID " }),
        vinNumbers: z
          .array(
              z.string({ message: "VIN Number must be a string" })
                .optional()
                .nullable()
                .refine((val) => {
                    if (val === undefined || val === null || val === "") 
                        return true;
                    return /^(M)[a-zA-Z0-9]{16}$/.test(val);
                  }, 
                  {
                    message: "Invalid VIN number format. Must start with 'M'",
                  })
          ).optional()
          .nullable(),
        deliveredDate: z.string()
          .optional()
          .nullable()
          .refine((val) => {
                    if (val === undefined || val === null || val === "") 
                      return true;
                    return /^\d{2}\/\d{2}\/\d{4}$/.test(val);
                  }, 
                  { 
                    message: "Must follow DD/MM/YYYY format" 
                  }) 
          .refine((val) => this.checkDateValue(val), {
              message: "Must be a valid calendar date and cannot be in the future",
          }),
        operationId: z.literal(99, {
            errorMap: (issue, ctx) => {
              if (issue.code === "invalid_literal") {
                return { message: "operationId Must be a 99 for data reconcilation" };
              }
              return { message: ctx.defaultError };
            },
          })
      });
      
      let {
        userid,
        vinNumbers,
        deliveredDate,
        operationId
      } = validateAllInputs(schema, {
        userid: req.userid,
        vinNumbers : req.body.vinNumbers,
        deliveredDate: req.body.deliveredDate,
        operationId: req.body.operationId
      });

      if(vinNumbers && vinNumbers.length == 0)
          vinNumbers = undefined;

      if(!vinNumbers && !deliveredDate){
        return APIResponseBadRequest(
          req,
          res,
          "INPUT_ERROR",
          null,
          "Either vinNumber or deliveredDate must be provided."
        );
      } 

      // Processing Data
      let adhocRunResult = await this.dmsHdlrImpl.ConsumeSoldVehiclesDataFromDms(
                                userid,
                                vinNumbers,
                                deliveredDate,
                                deliveredDate,
                                operationId
                              );
      // Adhoc run based DMS API Log
      req.body.response = adhocRunResult;
      req.body.vinNumber = 'ADHOC_CONSUME_RUN';
      let message = 'DMS Adhoc Consume Run completed successfully';
      this.dmsSvcI.StoreDmsApiLogs(req.body,{ resultcode : 'SUCCESS', statuscode: 200, message },null);
      APIResponseOK(req, res, adhocRunResult, message);
    } catch (error) {
      req.body.response = error.adhocRunResult;
      this.dmsSvcI.StoreDmsApiLogs(req.body,null,error);
      this.logger.error("ConsumeSoldVehicles error: ", error);
      if (error.errcode === "CONSOLE_ACCESS_DENIED") {
        APIResponseForbidden(
          req,
          res,
          "USER_ACCOUNT_ACCESS_DENIED",
          null,
          error.message
        );
      } else if (error.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(
          req,
          res,
          error.errcode,
          error.errdata,
          error.message,
        );
      } else {
        APIResponseInternalErr(
          req,
          res,
          "DMS_RECONCILE_SOLD_VEHICLES_ERR",
          error,
          "Reconcile Sold Vehicles failed"
        );
      }
    }
  };


  
}
