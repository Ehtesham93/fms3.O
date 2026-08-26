import ClickHouseClient from "../../../utils/clickhouse.js";
import clhTripTimeBucketRange from "./tripsinsightssvc_utils.js";

export default class TripsInsightSvcDB {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.clickHouseClient = new ClickHouseClient();
  }

  async getTripsByVehicle(accountid, vinno, starttime, endtime) {
    if (
      starttime >= endtime ||
      starttime < 0 ||
      endtime - starttime > 35 * 24 * 60 * 60 * 1000
    ) {
      return new Error("Invalid time range");
    }

    try {
      const timeBuckets = clhTripTimeBucketRange(starttime, endtime);
      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      const bucketPromises = timeBuckets.map(async (bucket) => {
        const query = `
          SELECT
            vin, starttime, endtime, startodo, endodo, startsoc, endsoc,
            starttemp, endtemp, startlat, endlat, startlng, endlng, startkwh, endkwh,
            startdte, enddte, boostduration, boostdist, boostsocusage, drivemodes,
            maxcurrent, maxvoltage, maxbattemp, maxspeed, maxmotortemp, movingtime,
            idletime, bmscyclenum, calcrange, startdata, enddata, proctime
          FROM lmmdata.tripdata_${bucket} 
          WHERE vin = {vin:String} 
            AND starttime >= {starttime:UInt64} 
            AND starttime < {endtime:UInt64}
            AND endodo - startodo > 2 
            AND endodo - startodo < 300 
            AND startsoc - endsoc > 1 
            AND startsoc - endsoc <= 100`;

        const params = {     // change the distinct
          vin: vinno,
          starttime: starttime,
          endtime: endtime,
        };

        try {
          const result = await this.clickHouseClient.query(query, params);
          if (!result.success) {
            this.logger.error("Error executing query:", result.error);
            return [];
          }
          return result.data || [];
        } catch (error) {
          this.logger.error("Error executing bucket query:", error);
          return [];
        }
      });

      const bucketResults = await Promise.allSettled(bucketPromises);
      const allResults = [];

      bucketResults.forEach(({ status, value }) => {
        if (status === "fulfilled" && Array.isArray(value)) {
          allResults.push(...value);
        } else if (status === "rejected") {
          this.logger.error("Bucket query failed:", value);
        }
      });

      allResults.forEach((row) => {
        if (row.startdata) {
          try {
            row.startdata =
              typeof row.startdata === "string"
                ? JSON.parse(row.startdata)
                : row.startdata;
          } catch (parseError) {
            this.logger.warn(
              `Failed to parse startdata JSON for VIN ${row.vin}:`,
              parseError
            );
          }
        }

        if (row.enddata) {
          try {
            row.enddata =
              typeof row.enddata === "string"
                ? JSON.parse(row.enddata)
                : row.enddata;
          } catch (parseError) {
            this.logger.warn(
              `Failed to parse enddata JSON for VIN ${row.vin}:`,
              parseError
            );
          }
        }

        if (typeof row.starttime === "string")
          row.starttime = parseInt(row.starttime, 10);
        if (typeof row.endtime === "string")
          row.endtime = parseInt(row.endtime, 10);
        if (typeof row.movingtime === "string")
          row.movingtime = parseInt(row.movingtime, 10);
        if (typeof row.idletime === "string")
          row.idletime = parseInt(row.idletime, 10);
        if (typeof row.boostduration === "string")
          row.boostduration = parseInt(row.boostduration, 10);
        if (typeof row.boostdist === "string")
          row.boostdist = parseInt(row.boostdist, 10);
      });

      allResults.sort((a, b) => a.starttime - b.starttime);
      return allResults;
    } catch (error) {
      this.logger.error("Error fetching vehicle trips data:", error);
      throw error;
    }
  }

  async getTripsByFleet(vinNumbers, starttime, endtime) {
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
      const timeBuckets = clhTripTimeBucketRange(starttime, endtime);
      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      const bucketPromises = timeBuckets.map(async (bucket) => {
        const vinPlaceholders = vinNumbers
          .map((_, index) => `{vin${index}:String}`)
          .join(",");
        const query = `
          SELECT
            vin, starttime, endtime, startodo, endodo, startsoc, endsoc,
            starttemp, endtemp, startlat, endlat, startlng, endlng, startkwh, endkwh,
            startdte, enddte, boostduration, boostdist, boostsocusage, drivemodes, maxcurrent, maxvoltage,
            maxbattemp, maxspeed, maxmotortemp, movingtime,
            idletime, bmscyclenum, calcrange, startdata, enddata, proctime
          FROM lmmdata.tripdata_${bucket} 
          WHERE vin IN (${vinPlaceholders})
            AND starttime >= {starttime:UInt64} 
            AND starttime < {endtime:UInt64}
            AND endodo - startodo > 2 
            AND endodo - startodo < 300 
            AND startsoc - endsoc > 1 
            AND startsoc - endsoc <= 100`;

        const params = {     // change the distinct
          starttime: starttime,
          endtime: endtime,
        };

        vinNumbers.forEach((vin, index) => {
          params[`vin${index}`] = vin;
        });

        try {
          const result = await this.clickHouseClient.query(query, params);
          if (!result.success) {
            this.logger.error("Error executing query:", result.error);
            return [];
          }
          return result.data || [];
        } catch (error) {
          this.logger.error("Error executing bucket query:", error);
          return [];
        }
      });

      const bucketResults = await Promise.allSettled(bucketPromises);
      const allResults = [];

      bucketResults.forEach(({ status, value }) => {
        if (status === "fulfilled" && Array.isArray(value)) {
          allResults.push(...value);
        } else if (status === "rejected") {
          this.logger.error("Bucket query failed:", value);
        }
      });

      allResults.forEach((row) => {
        if (row.startdata) {
          try {
            row.startdata =
              typeof row.startdata === "string"
                ? JSON.parse(row.startdata)
                : row.startdata;
          } catch (parseError) {
            this.logger.warn(
              `Failed to parse startdata JSON for VIN ${row.vin}:`,
              parseError
            );
          }
        }

        if (row.enddata) {
          try {
            row.enddata =
              typeof row.enddata === "string"
                ? JSON.parse(row.enddata)
                : row.enddata;
          } catch (parseError) {
            this.logger.warn(
              `Failed to parse enddata JSON for VIN ${row.vin}:`,
              parseError
            );
          }
        }

        if (typeof row.starttime === "string")
          row.starttime = parseInt(row.starttime, 10);
        if (typeof row.endtime === "string")
          row.endtime = parseInt(row.endtime, 10);
        if (typeof row.movingtime === "string")
          row.movingtime = parseInt(row.movingtime, 10);
        if (typeof row.idletime === "string")
          row.idletime = parseInt(row.idletime, 10);
        if (typeof row.boostduration === "string")
          row.boostduration = parseInt(row.boostduration, 10);
        if (typeof row.boostdist === "string")
          row.boostdist = parseInt(row.boostdist, 10);
      });

      allResults.sort((a, b) => a.starttime - b.starttime);
      return allResults;
    } catch (error) {
      this.logger.error("Error fetching fleet trips data:", error);
      throw error;
    }
  }

  async getAllTripsByFleet(vinNumbers, starttime, endtime) {
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
      const timeBuckets = clhTripTimeBucketRange(starttime, endtime);
      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      const bucketPromises = timeBuckets.map(async (bucket) => {
        const vinPlaceholders = vinNumbers
          .map((_, index) => `{vin${index}:String}`)
          .join(",");
        const query = `
        SELECT 
          vin, starttime, endtime, startodo, endodo, startsoc, endsoc,
            starttemp, endtemp, startlat, endlat, startlng, endlng,
            startdte, enddte, boostduration, boostdist, boostsocusage, drivemodes, maxcurrent, maxvoltage,
            maxbattemp, maxspeed, maxmotortemp, movingtime,
            idletime, bmscyclenum, calcrange, startdata, enddata, proctime
          FROM lmmdata.tripdata_${bucket} 
        WHERE vin IN (${vinPlaceholders})
          AND starttime >= {starttime:UInt64} 
          AND starttime < {endtime:UInt64}
          AND endodo - startodo > 0 
          AND endodo - startodo < 300 
          AND startsoc - endsoc > 1 
          AND startsoc - endsoc <= 100`;

        const params = {     // change the distinct
          starttime: starttime,
          endtime: endtime,
        };

        vinNumbers.forEach((vin, index) => {
          params[`vin${index}`] = vin;
        });

        try {
          const result = await this.clickHouseClient.query(query, params);
          if (!result.success) {
            this.logger.error("Error executing query:", result.error);
            return [];
          }
          return result.data || [];
        } catch (error) {
          this.logger.error("Error executing bucket query:", error);
          return [];
        }
      });

      const bucketResults = await Promise.allSettled(bucketPromises);
      const allResults = [];

      bucketResults.forEach(({ status, value }) => {
        if (status === "fulfilled" && Array.isArray(value)) {
          allResults.push(...value);
        } else if (status === "rejected") {
          this.logger.error("Bucket query failed:", value);
        }
      });

      // Convert string fields to numbers
      allResults.forEach((row) => {
        if (typeof row.starttime === "string")
          row.starttime = parseInt(row.starttime, 10);
        if (typeof row.endtime === "string")
          row.endtime = parseInt(row.endtime, 10);
        if (typeof row.movingtime === "string")
          row.movingtime = parseInt(row.movingtime, 10);
        if (typeof row.idletime === "string")
          row.idletime = parseInt(row.idletime, 10);
      });

      allResults.sort((a, b) => a.starttime - b.starttime);
      return allResults;
    } catch (error) {
      this.logger.error("Error fetching all fleet trips data:", error);
      throw error;
    }
  }
}
