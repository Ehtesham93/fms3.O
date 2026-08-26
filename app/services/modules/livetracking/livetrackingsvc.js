import LivetrackingsvcDB from "./livetrackingsvc_db.js";

export default class Livetrackingsvc {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.livetrackingsvcDB = new LivetrackingsvcDB(pgPoolI, logger, config);
  }

  async getVehicles(accountid, fleetid, recursive) {
    return await this.livetrackingsvcDB.getVehicles(
      accountid,
      fleetid,
      recursive
    );
  }

  async getVehicleInfo(accountid, vinno) {
    return await this.livetrackingsvcDB.getVehicleInfo(accountid, vinno);
  }

  async checkVehicleExists(accountid, vinno) {
    return await this.livetrackingsvcDB.checkVehicleExists(accountid, vinno);
  }
}
