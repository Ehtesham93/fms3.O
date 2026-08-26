import ClickHouseClient from "../../../utils/clickhouse.js";
import clhChargeTimeBucketRange from "./chargeinsightssvc_utils.js";

export default class ChargeInsightSvcDB {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.clickHouseClient = new ClickHouseClient();
  }

  async getChargeInsightsByVehicle(accountid, vinno, starttime, endtime) {
    if (
      starttime >= endtime ||
      starttime < 0 ||
      endtime - starttime > 35 * 24 * 60 * 60 * 1000
    ) {
      return new Error("Invalid time range");
    }

    try {
      const timeBuckets = clhChargeTimeBucketRange(starttime, endtime);
      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      const bucketPromises = timeBuckets.map(async (bucket) => {
        const query = `
        SELECT 
          vin, event, starttime, endtime, startodo, startsoc, endsoc, startkwh, endkwh,
          starttemp, endtemp, startlat, endlat, startlng, endlng,
          startdte, enddte, maxcurrent, maxvoltage, maxbattemp,
          maxmotortemp, isfastcharging, bmscyclenum, startdata, enddata, proctime
        FROM lmmdata.chargedata_${bucket} 
        WHERE vin = {vin:String} 
          AND starttime >= {starttime:UInt64} 
          AND starttime < {endtime:UInt64}
          AND event = 'charge'
          AND endsoc - startsoc >= 1`;

        const params = {
          vin: vinno,
          starttime: starttime,
          endtime: endtime,
        };

        try {
          const result = await this.clickHouseClient.query(query, params);
          if (!result.success) {
            return [];
          }
          return result.data || [];
        } catch (error) {
          return [];
        }
      });

      const bucketResults = await Promise.allSettled(bucketPromises);
      const allResults = [];

      bucketResults.forEach(({ status, value }) => {
        if (status === "fulfilled" && Array.isArray(value)) {
          allResults.push(...value);
        } else if (status === "rejected") {
        }
      });

      allResults.forEach((row) => {
        if (row.startdata) {
          try {
            row.startdata =
              typeof row.startdata === "string"
                ? JSON.parse(row.startdata)
                : row.startdata;
          } catch (parseError) {}
        }

        if (row.enddata) {
          try {
            row.enddata =
              typeof row.enddata === "string"
                ? JSON.parse(row.enddata)
                : row.enddata;
          } catch (parseError) {}
        }

        if (typeof row.starttime === "string") {
          row.starttime = parseInt(row.starttime, 10);
        }
        if (typeof row.endtime === "string") {
          row.endtime = parseInt(row.endtime, 10);
        }

        row.chargingtime = row.endtime - row.starttime;
      });

      allResults.sort((a, b) => a.starttime - b.starttime);
      return allResults;
    } catch (error) {
      throw error;
    }
  }

  async getChargeInsightsByFleet(accountid, vinNumbers, starttime, endtime) {
    if (
      starttime >= endtime ||
      starttime < 0 ||
      endtime - starttime > 35 * 24 * 60 * 60 * 1000
    ) {
      return new Error("Invalid time range");
    }

    if (!Array.isArray(vinNumbers) || vinNumbers.length === 0) {
      return [];
    }

    try {
      const timeBuckets = clhChargeTimeBucketRange(starttime, endtime);
      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      const bucketPromises = timeBuckets.map(async (bucket) => {
        const vinPlaceholders = vinNumbers
          .map((_, index) => `{vin${index}:String}`)
          .join(",");
        const query = `
        SELECT 
          vin, event, starttime, endtime, startodo, startsoc, endsoc, startkwh, endkwh,
          starttemp, endtemp, startlat, endlat, startlng, endlng,
          startdte, enddte, maxcurrent, maxvoltage, maxbattemp,
          maxmotortemp, isfastcharging, bmscyclenum, startdata, enddata, proctime
        FROM lmmdata.chargedata_${bucket} 
        WHERE vin IN (${vinPlaceholders})
          AND starttime >= {starttime:UInt64} 
          AND starttime < {endtime:UInt64}
          AND event = 'charge'
          AND endsoc - startsoc >= 1`;

        const params = {
          starttime: starttime,
          endtime: endtime,
        };

        vinNumbers.forEach((vin, index) => {
          params[`vin${index}`] = vin;
        });

        try {
          const result = await this.clickHouseClient.query(query, params);
          if (!result.success) {
            return [];
          }
          return result.data || [];
        } catch (error) {
          return [];
        }
      });

      const bucketResults = await Promise.allSettled(bucketPromises);
      const allResults = [];

      bucketResults.forEach(({ status, value }) => {
        if (status === "fulfilled" && Array.isArray(value)) {
          allResults.push(...value);
        } else if (status === "rejected") {
        }
      });

      allResults.forEach((row) => {
        if (row.startdata) {
          try {
            row.startdata =
              typeof row.startdata === "string"
                ? JSON.parse(row.startdata)
                : row.startdata;
          } catch (parseError) {}
        }

        if (row.enddata) {
          try {
            row.enddata =
              typeof row.enddata === "string"
                ? JSON.parse(row.enddata)
                : row.enddata;
          } catch (parseError) {}
        }

        if (typeof row.starttime === "string")
          row.starttime = parseInt(row.starttime, 10);
        if (typeof row.endtime === "string")
          row.endtime = parseInt(row.endtime, 10);
        row.chargingtime = row.endtime - row.starttime;
      });

      allResults.sort((a, b) => a.starttime - b.starttime);
      return allResults;
    } catch (error) {
      throw error;
    }
  }
}
