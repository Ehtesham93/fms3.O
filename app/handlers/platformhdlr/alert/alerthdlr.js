import z from "zod";

import {
  ADMIN_ROLE_ID,
  INVITE_RATE_LIMIT_PER_HOUR,
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
import AlertHdlrImpl from "./alerthdlr_impl.js";


export default class AlertHdlr {
  constructor(alertSvcI, logger) {
    this.alertSvcI = alertSvcI;
    this.logger = logger;
    this.alertHdlrImpl = new AlertHdlrImpl(alertSvcI, logger);
  }


    RegisterRoutes(router) {
    router.get("/", this.ListAlerts);
    router.get("/info", this.GetAlert);
    router.post("/", this.CreateAlert);
    router.put("/update", this.UpdateAlert);
    router.delete("/delete", this.DeleteAlert);
  }

  ListAlerts = async (req, res, next) => {
    try {
      let result = await this.alertHdlrImpl.ListAlertsLogic();
      APIResponseOK(req, res, result, "Alerts listed successfully");
    } catch (e) {
      this.logger.error("ListAlerts error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "LIST_ALERTS_ERR",
        e.toString(),
        "List alerts failed"
      );
    }
  };

  GetAlert = async (req, res, next) => {
    if (
      !CheckUserPerms(req.userperms, [
        "consolemgmt.alert.admin",
        "consolemgmt.alert.view",
      ])
    ) {
      return APIResponseForbidden(
        req,
        res,
        "INSUFFICIENT_PERMISSIONS",
        null,
        "You don't have permission to get alert."
      );
    }
    try {
      let schema = z.object({
        alertid: z
          .string({ message: "Alert ID is required" }),
        faultid: z
          .string({ message: "Fault ID is required" }),
      });

      let { alertid, faultid } = validateAllInputs(schema, {
        alertid: req.query.alertid,
        faultid: req.query.faultid,
      });

      let result = await this.alertHdlrImpl.GetAlertLogic(alertid, faultid);
      APIResponseOK(req, res, result, "Alert fetched successfully");
    } catch (e) {
      this.logger.error("GetAlert error: ", e);
      if (e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(
          req,
          res,
          "GET_ALERT_ERR",
          e.toString(),
          "Get alert failed"
        );
      }
    }
  };

  CreateAlert = async (req, res, next) => {
    if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.alert.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to create alert."
        );
      }
    try {
        let schema = z.object({
            alertid: z
              .string({ message: "Invalid alert ID format" }),
            faultid: z
              .string({ message: "Invalid fault ID format" }),
            category: z
              .string({ message: "Invalid category format" }),
            alerttype: z
              .string({ message: "Invalid alert type format" }),
            severity: z
              .string({ message: "Invalid severity format" }),
            cta: z
              .string({ message: "Invalid CTA format" }),
            alertsubject: z
              .string({ message: "Invalid alert subject format" }),
            notification_subject: z
              .string({ message: "Invalid notification subject format" }),
            description: z
              .string({ message: "Invalid description format" }),
            notifyapp: z
              .boolean({ message: "Invalid notify app format" }),
            notifyfms: z
              .boolean({ message: "Invalid notify FMS format" }),
            notifyvmc: z
              .boolean({ message: "Invalid notify VMC format" }),
          });
      let { alertid, faultid, category, alerttype, severity, cta, alertsubject, notification_subject, description, notifyapp, notifyfms, notifyvmc } = validateAllInputs(schema, {
        alertid: req.body.alertid,
        faultid: req.body.faultid,
        category: req.body.category,
        alerttype: req.body.alerttype,
        severity: req.body.severity,
        cta: req.body.cta,
        alertsubject: req.body.alertsubject,
        notification_subject: req.body.notification_subject,
        description: req.body.description,
        notifyapp: req.body.notifyapp,
        notifyfms: req.body.notifyfms,
        notifyvmc: req.body.notifyvmc,
      });
      let createdby = req.userid;
      let result = await this.alertHdlrImpl.CreateAlertLogic(alertid, faultid, category, alerttype, severity, cta, alertsubject, notification_subject, description, notifyapp, notifyfms, notifyvmc);
      APIResponseOK(req, res, result, "Alert created successfully");
    } catch (e) {
      this.logger.error("CreateAlert error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "CREATE_ALERT_ERR",
        e.toString(),
        "Create alert failed"
      );
    }
  };

  UpdateAlert = async (req, res, next) => {
    if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.alert.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to update alert."
        );
      }
    try {
      const schema = z.object({
            alertid: z
              .string({ message: "Invalid alert ID format" }),
            faultid: z
              .string({ message: "Invalid fault ID format" }),
            category: z
              .string({ message: "Invalid category format" }),
            alerttype: z
              .string({ message: "Invalid alert type format" }),
            severity: z
              .string({ message: "Invalid severity format" }),
            cta: z
              .string({ message: "Invalid CTA format" }),
            alertsubject: z
              .string({ message: "Invalid alert subject format" }),
            notification_subject: z
              .string({ message: "Invalid notification subject format" }),
            description: z
              .string({ message: "Invalid description format" }),
            notifyapp: z
              .boolean({ message: "Invalid notify app format" }),
            notifyfms: z
              .boolean({ message: "Invalid notify FMS format" }),
            notifyvmc: z
              .boolean({ message: "Invalid notify VMC format" }),
      });

      const validatedData = validateAllInputs(schema, {
        alertid: req.query.alertid,
        faultid: req.query.faultid,
        ...req.body,
        updatedby: req.userid,
      });

      const updateFields = {};
      const allowedFields = [
        "category",
        "alerttype",
        "severity",
        "cta",
        "alertsubject",
        "notification_subject",
        "description",
        "notifyapp",
        "notifyfms",
        "notifyvmc",
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

      let result = await this.alertHdlrImpl.UpdateAlertLogic(req.query.alertid, req.query.faultid, updateFields);
      APIResponseOK(req, res, result, "Alert updated successfully");
    } catch (e) {
      this.logger.error("UpdateAlert error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "UPDATE_ALERT_ERR",
        e.toString(),
        "Update alert failed"
      );
    }
  };

  DeleteAlert = async (req, res, next) => {
    if (
        !CheckUserPerms(req.userperms, [
          "consolemgmt.alert.admin",
        ])
      ) {
        return APIResponseForbidden(
          req,
          res,
          "INSUFFICIENT_PERMISSIONS",
          null,
          "You don't have permission to delete alert."
        );
      }
    try {
      const schema = z.object({
        alertid: z
          .string({ message: "Invalid alert ID format" }),
        faultid: z
          .string({ message: "Invalid fault ID format" }),
      });
      let { alertid, faultid } = validateAllInputs(schema, {
        alertid: req.query.alertid,
        faultid: req.query.faultid,
      });
      
      let result = await this.alertHdlrImpl.DeleteAlertLogic(alertid, faultid);
      APIResponseOK(req, res, result, "Alert deleted successfully");
    } catch (e) {
      this.logger.error("DeleteAlert error: ", e);
      APIResponseInternalErr(
        req,
        res,
        "DELETE_ALERT_ERR",
        e.toString(),
        "Delete alert failed"
      );
    }
  };
}