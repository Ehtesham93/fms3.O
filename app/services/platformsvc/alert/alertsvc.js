import AlertSvcDB from "./alertsvc_db.js";

export default class AlertSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.alertSvcDB = new AlertSvcDB(pgPoolI, logger);
  }

  ListAlerts = async () => {
    return await this.alertSvcDB.ListAlerts();
  };

  GetAlert = async (alertid, faultid) => {
    return await this.alertSvcDB.GetAlert(alertid, faultid);
  };

  CreateAlert = async (alert) => {
    return await this.alertSvcDB.CreateAlert(alert);
  };

  UpdateAlert = async (alertid, faultid, updateFields) => {
    return await this.alertSvcDB.UpdateAlert(alertid, faultid, updateFields);
  };

  DeleteAlert = async (alertid, faultid) => {
    return await this.alertSvcDB.DeleteAlert(alertid, faultid);
  };
}