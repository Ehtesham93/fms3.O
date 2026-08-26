import FleetInsightSvcDB from "./fleetinsightssvc_db.js";
import ChargeInsightSvcDB from "../chargeinsights/chargeinsightssvc_db.js";
import TripsInsightSvcDB from "../tripsinsights/tripsinsightssvc_db.js";

export default class FleetInsightSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.fleetInsightSvcDB = new FleetInsightSvcDB(pgPoolI, logger);
    this.chargeInsightSvcDB = new ChargeInsightSvcDB(pgPoolI, logger);
    this.tripsInsightSvcDB = new TripsInsightSvcDB(pgPoolI, logger);
  }

  async GetLatestCanData(vinnos) {
    return await this.fleetInsightSvcDB.getLatestCanData(vinnos);
  }

  async GetChargeInsightsByFleet(accountid, vinNumbers, starttime, endtime) {
    return await this.chargeInsightSvcDB.getChargeInsightsByFleet(
      accountid,
      vinNumbers,
      starttime,
      endtime
    );
  }
  async GetChargeDeviations() {
    const result = await this.pgPoolI.Query(
      'SELECT deviation_code, deviation_text FROM charge_deviation'
    );
    return result.rows;
  }

  async GetTripsByFleet(vinNumbers, starttime, endtime) {
    return await this.tripsInsightSvcDB.getTripsByFleet(
      vinNumbers,
      starttime,
      endtime
    );
  }
}
