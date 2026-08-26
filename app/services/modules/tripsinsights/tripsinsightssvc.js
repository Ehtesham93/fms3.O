import TripsInsightSvcDB from "./tripsinsightssvc_db.js";

export default class TripsInsightSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.tripsInsightSvcDB = new TripsInsightSvcDB(pgPoolI, logger);
  }

  async GetTripsByVehicle(accountid, vinno, starttime, endtime) {
    return await this.tripsInsightSvcDB.getTripsByVehicle(
      accountid,
      vinno,
      starttime,
      endtime
    );
  }

  async GetTripsByFleet(vinNumbers, starttime, endtime) {
    return await this.tripsInsightSvcDB.getTripsByFleet(
      vinNumbers,
      starttime,
      endtime
    );
  }

  async GetAllTripsByFleet(vinNumbers, starttime, endtime) {
    return await this.tripsInsightSvcDB.getAllTripsByFleet(
      vinNumbers,
      starttime,
      endtime
    );
  }
}
