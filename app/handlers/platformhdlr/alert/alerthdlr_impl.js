export default class AlertHdlrImpl {
  constructor(alertSvcI, logger) {
    this.alertSvcI = alertSvcI;
    this.logger = logger;
  }

  ListAlertsLogic = async () => {
    let alerts = await this.alertSvcI.ListAlerts();
    if (!alerts) {
      alerts = [];
    }
    alerts = alerts.map((alert) => {
      return alert;
    });
    return {
      alerts: alerts,
    };
  };

  GetAlertLogic = async (alertid, faultid) => {
    let alert = await this.alertSvcI.GetAlert(alertid, faultid);
    if (!alert) {
      this.logger.error("Alert not found");
      throw new Error("Alert not found");
    }
    return {
      alert: alert,
    };
  };

  CreateAlertLogic = async (
    alertid,
    faultid,
    category,
    alerttype,
    severity,
    cta,
    alertsubject,
    notification_subject,
    description,
    notifyapp,
    notifyfms,
    notifyvmc
  ) => {
    let alert = {
      alertid: alertid,
      faultid: faultid,
      category: category,
      alerttype: alerttype,
      severity: severity,
      cta: cta,
      alertsubject: alertsubject,
      notification_subject: notification_subject,
      description: description,
      notifyapp: notifyapp,
      notifyfms: notifyfms,
      notifyvmc: notifyvmc,
    };
    let res = await this.alertSvcI.CreateAlert(alert);
    if (!res) {
      this.logger.error("Failed to create alert");
      throw new Error("Failed to create alert");
    } else if (res.errcode === "ALERT_ALREADY_EXISTS") {
      throw res;
    }
    
    return {
      alertid: alertid,
      faultid: faultid,
      alert: alert,
    };
  };

  UpdateAlertLogic = async (alertid, faultid, updateFields) => {
    const processedFields = {};

    if (updateFields.hasOwnProperty("category")) {
      processedFields.category = updateFields.category;
    }

    if (updateFields.hasOwnProperty("alerttype")) {
      processedFields.alerttype = updateFields.alerttype;
    }

    if (updateFields.hasOwnProperty("severity")) {
      processedFields.severity = updateFields.severity;
    }

    if (updateFields.hasOwnProperty("cta")) {
      processedFields.cta = updateFields.cta;
    }

    if (updateFields.hasOwnProperty("alertsubject")) {
      processedFields.alertsubject = updateFields.alertsubject;
    }

    if (updateFields.hasOwnProperty("priority")) {
      processedFields.priority = updateFields.priority;
    }

    if (updateFields.hasOwnProperty("notification_subject")) {
      processedFields.notification_subject = updateFields.notification_subject;
    }

    if (updateFields.hasOwnProperty("description")) {
      processedFields.description = updateFields.description;
    }

    if (updateFields.hasOwnProperty("notifyapp")) {
      processedFields.notifyapp = updateFields.notifyapp;
    }

    if (updateFields.hasOwnProperty("notifyfms")) {
      processedFields.notifyfms = updateFields.notifyfms;
    }

    if (updateFields.hasOwnProperty("notifyvmc")) {
      processedFields.notifyvmc = updateFields.notifyvmc;
    }

    let res = await this.alertSvcI.UpdateAlert(
      alertid,
      faultid,
      processedFields,
    );
    if (!res) {
      this.logger.error("Failed to update alert");
      throw new Error("Failed to update alert");
    }

    return {
      alertid: alertid,
      faultid: faultid,
    };
  };

  DeleteAlertLogic = async (alertid, faultid) => {
    let alert = await this.alertSvcI.GetAlert(alertid, faultid);
    if (!alert) {
      this.logger.error("Alert not found");
      throw new Error("Alert not found");
    }
    let res = await this.alertSvcI.DeleteAlert(alertid, faultid);
    if (!res) {
      this.logger.error("Failed to delete alert");
      throw new Error("Failed to delete alert");
    }
  };
}