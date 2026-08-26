import ChargeInsightSvcDB from "./chargeinsightssvc_db.js";

export default class ChargeInsightSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.chargeInsightSvcDB = new ChargeInsightSvcDB(pgPoolI, logger);
  }

  async GetChargeInsightsByVehicle(accountid, vinno, starttime, endtime) {
    return await this.chargeInsightSvcDB.getChargeInsightsByVehicle(
      accountid,
      vinno,
      starttime,
      endtime
    );
  }

  async GetChargeInsightsByFleet(accountid, vinNumbers, starttime, endtime) {
    return await this.chargeInsightSvcDB.getChargeInsightsByFleet(
      accountid,
      vinNumbers,
      starttime,
      endtime
    );
  }
}
