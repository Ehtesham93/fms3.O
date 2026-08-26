import ClickHouseClient from "../../../utils/clickhouse.js";
import clhChargeTimeBucketRange from "./fleetinsightssvc_utils.js";

export default class FleetInsightSvcDB {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.clickHouseClient = new ClickHouseClient();
  }

  async getLatestCanData(vinnos) {
    try {
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const query = `
        SELECT odometer, bms_cyclenum, vin
        FROM lmmdata_latest.candatalatest
        WHERE vin IN (${vinList})
      `;

      const result = await this.clickHouseClient.query(query);

      if (!result.success) {
        this.logger.error(
          "Failed to query ClickHouse for CAN data:",
          result.error
        );
        throw new Error("Failed to fetch latest CAN data");
      }

      const canDataMap = {};
      for (let row of result.data) {
        canDataMap[row.vin] = {
          odometer: row.odometer,
          bms_cyclenum: row.bms_cyclenum,
        };
      }

      return canDataMap;
    } catch (error) {
      this.logger.error("Error fetching latest vehicle data:", error);
      throw error;
    }
  }
}
