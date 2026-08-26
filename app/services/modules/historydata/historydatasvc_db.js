import clhTimeBucketRange from "./historydatasvc_utils.js";
import { PARAM_FAMILY_CODE_REGULAR_DATA } from "../../../utils/constant.js";

export default class HistoryDataSvcDB {
  constructor(pgPoolI, clickHouseClient, logger, redisSvc) {
    this.pgPoolI = pgPoolI;
    this.clickHouseClient = clickHouseClient;
    this.logger = logger;
    this.redisSvc = redisSvc;
    this.canmetrics = [
      "cycletime",
      "charger_sts_live",
      "bms_charger_plug_in_sts",
      "drive_enable",
      "bms_hvbatt_connect_sts",
      "bms_hvbatt_disconnect_sts",
      "bms_in_keyon",
      "bms_cyclenum",
      "charger_temp_live",
      "chargertemp",
      "soc",
      "soh",
      "bms_cell_avg_volt",
      "bms_cell_avg_temp",
      "motortemp",
      "bms_batt_pack_temp",
      "brake_switch_status",
      "odometer",
      "vehiclespeed",
      "motorpower",
      "e_motor_rpm",
      "inv_drivemode_shift",
      "v_mode",
      "battery_ttc",
      "percthrottle",
      "kwh",
      "batt_current",
      "aux_batt_volt",
      "bat_voltage",
      "dte",
      "can_throttle",
      "wakeup_command",
      "veh_immo_resp",
      "service_tt",
      "chargett",
      "connectionhealthtt",
      "tcu_speedmode",
      "Test Data",
      "aux_batt_volt",
    ];
  }

  async getGPSHistoryData(accountid, vinnumber, starttime, endtime) {
    // TODO: add accountid and fleetid check later
    const currtime = Date.now();

    // Validate time range
    if (
      starttime >= endtime ||
      endtime > currtime ||
      starttime < 0 ||
      endtime - starttime > 31 * 24 * 60 * 60 * 1000
    ) {
      return new Error("Invalid time range");
    }

    try {
      // Get the time buckets for the given time range
      const timeBuckets = clhTimeBucketRange(starttime, endtime);
      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      // Build the query for each time bucket
      const queries = timeBuckets.map((bucket) => {
        return `
          SELECT 
            vin, 
            utctime, 
            altitude, 
            gpstime, 
            intime, 
            latdir, 
            latitude, 
            longdir, 
            longitude, 
            speed, 
            valid, 
            proctime, 
            packettype 
          FROM lmmdata.gpsdata_${bucket} 
          WHERE vin = '${vinnumber}' 
            AND utctime >= ${starttime} 
            AND utctime <= ${endtime}
            AND longitude != 0
            AND latitude != 0`;
      });

      // Execute all queries in parallel
      const results = [];
      await Promise.all(
        queries.map((query) => {
          return this.clickHouseClient.queryWithCallback(
            query,
            (err, result) => {
              if (err) {
                console.error("Error executing query:", err);
                return [];
              }
              result.forEach((row) => {
                results.push(row);
              });
            }
          );
        })
      );

      // Sort results by utctime in ascending order
      results.sort((a, b) => a.utctime - b.utctime);

      const formattedResults = this.formatGPSData(results);

      return formattedResults;
    } catch (error) {
      this.logger.error("Error fetching GPS history data:", error);
      throw error;
    }
  }

  // helper function to convert type

  formatGPSData(data) {
    return data.map((row) => {
      const formatted = { ...row };

      // Convert UInt64 fields
      if (formatted.utctime !== undefined)
        formatted.utctime = parseInt(formatted.utctime) || 0;
      if (formatted.altitude !== undefined)
        formatted.altitude = parseInt(formatted.altitude) || 0;
      if (formatted.gpstime !== undefined)
        formatted.gpstime = parseInt(formatted.gpstime) || 0;
      if (formatted.intime !== undefined)
        formatted.intime = parseInt(formatted.intime) || 0;
      if (formatted.speed !== undefined)
        formatted.speed = parseInt(formatted.speed) || 0;
      if (formatted.proctime !== undefined)
        formatted.proctime = parseInt(formatted.proctime) || 0;

      // Convert Float64 fields
      if (formatted.latitude !== undefined)
        formatted.latitude = parseFloat(formatted.latitude) || 0;
      if (formatted.longitude !== undefined)
        formatted.longitude = parseFloat(formatted.longitude) || 0;

      return formatted;
    });
  }

  formatCANData(data) {
    return data.map((row) => {
      const formatted = { ...row };

      // Convert UInt64 fields
      if (formatted.utctime !== undefined)
        formatted.utctime = parseInt(formatted.utctime) || 0;
      if (formatted.intime !== undefined)
        formatted.intime = parseInt(formatted.intime) || 0;
      if (formatted.proctime !== undefined)
        formatted.proctime = parseInt(formatted.proctime) || 0;

      // Convert UInt32 fields
      const uint32Fields = [
        "bms_cyclenum",
        "can_soc",
        "soh",
        "brake_switch_status",
        "e_motor_rpm",
        "inv_drivemode_shift",
        "v_mode",
        "battery_ttc",
        "can_dte",
        "can_throttle",
        "veh_immo_resp",
        "service_tt",
        "chargett",
        "connectionhealthtt",
        "tcu_speedmode",
      ];
      uint32Fields.forEach((field) => {
        if (formatted[field] !== undefined) {
          formatted[field] = parseInt(formatted[field]) || 0;
        }
      });

      // Convert Float32 fields
      const float32Fields = [
        "charger_temp_live",
        "chargertemp",
        "soc",
        "bms_cell_avg_volt",
        "bms_cell_avg_temp",
        "motortemp",
        "bms_batt_pack_temp",
        "odometer",
        "odometer_new",
        "vehiclespeed",
        "motorpower",
        "percthrottle",
        "kwh",
        "batt_current",
        "aux_batt_volt",
        "bat_voltage",
        "dte",
        "wakeup_command",
      ];
      float32Fields.forEach((field) => {
        if (formatted[field] !== undefined) {
          formatted[field] = parseFloat(formatted[field]) || 0;
        }
      });

      return formatted;
    });
  }

  async getCANHistoryData(accountid, vinnumber, starttime, endtime, canparams) {
    const currtime = Date.now();
    if (
      starttime >= endtime ||
      endtime > currtime ||
      starttime < 0 ||
      endtime - starttime > 31 * 24 * 60 * 60 * 1000
    ) {
      return new Error("Invalid time range");
    }

    if (!Array.isArray(canparams) || canparams.length === 0) {
      return new Error("canparams must be a non-empty array");
    }

    if (!canparams.every((param) => typeof param === "string")) {
      return new Error("canparams must contain only strings");
    }

    try {
      const allCanParams = await this.getAllCanParams();

      if (allCanParams.length === 0) {
        return new Error("Could not fetch All CAN params");
      }

      if (!canparams.every((param) => allCanParams.includes(param))) {
        return new Error("Some CAN params does not exist");
      }

      // Get the time buckets for the given time range
      const timeBuckets = clhTimeBucketRange(starttime, endtime);

      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      // Build the query for each time bucket
      const queries = timeBuckets.map((bucket) => {
        return `SELECT vin, utctime, intime, valid, proctime, packettype, ${canparams.join(
          ","
        )} FROM lmmdata.candata_${bucket} WHERE vin = '${vinnumber}' AND utctime >= ${starttime} AND utctime <= ${endtime} AND odometer > 1`;
      });

      // Execute all queries in parallel
      const results = [];
      await Promise.all(
        queries.map((query) => {
          return this.clickHouseClient.queryWithCallback(
            query,
            (err, result) => {
              if (err) {
                console.error("Error executing query:", err);
                return [];
              }
              result.forEach((row) => {
                results.push(row);
              });
            }
          );
        })
      );

      // Sort results by utctime in ascending order
      results.sort((a, b) => a.utctime - b.utctime);

      const formattedResults = this.formatCANData(results);

      return formattedResults;
    } catch (error) {
      this.logger.error("Error fetching GPS history data:", error);
      throw error;
    }
  }

  async getAllCanParams() {
    const canParamsQuery = `SELECT paramcode from paramfamily_param WHERE paramfamilycode = $1`;
    const canParamsResult = await this.pgPoolI.Query(canParamsQuery, [
      PARAM_FAMILY_CODE_REGULAR_DATA,
    ]);

    if (canParamsResult.rows.length === 0) {
      return [];
    }

    return canParamsResult.rows.map((row) => row.paramcode);
  }

  async getMergedCANGPSHistoryData(
    accountid,
    vinnumber,
    starttime,
    endtime,
    canparams
  ) {
    if (
      starttime >= endtime ||
      starttime < 0 ||
      endtime - starttime > 31 * 24 * 60 * 60 * 1000
    ) {
      return new Error("Invalid time range");
    }

    if (!Array.isArray(canparams) || canparams.length === 0) {
      return new Error("canparams must be a non-empty array");
    }

    if (!canparams.every((param) => typeof param === "string")) {
      return new Error("canparams must contain only strings");
    }

    try {
      const allCanParams = await this.getAllCanParams();

      if (allCanParams.length === 0) {
        return new Error("Could not fetch All CAN params");
      }

      const missing = canparams.filter((p) => !allCanParams.includes(p));
      if (missing.length > 0) {
        return new Error(`Invalid parameters found: ${missing.join(", ")}`);
      }

      const vehicleQuery = `SELECT modelcode FROM vehicle WHERE vinno = $1`;
      const vehicleResult = await this.pgPoolI.Query(vehicleQuery, [vinnumber]);

      if (vehicleResult.rows.length === 0) {
        return new Error("Vehicle not found");
      }

      const modelcode = vehicleResult.rows[0].modelcode;

      const timeBuckets = clhTimeBucketRange(starttime, endtime);
      if (timeBuckets.length === 0) {
        return new Error("No valid time buckets found");
      }

      const canQueries = timeBuckets.map((bucket) => {
        return `SELECT vin, utctime, intime, valid, proctime, packettype, ${canparams.join(
          ","
        )} FROM lmmdata.candata_${bucket} WHERE vin = '${vinnumber}' AND utctime >= ${starttime} AND utctime <= ${endtime} AND odometer > 1`;
      });

      const gpsQueries = timeBuckets.map((bucket) => {
        return `
          SELECT 
            vin, 
            utctime, 
            gpstime, 
            latdir, 
            latitude, 
            longdir, 
            longitude 
          FROM lmmdata.gpsdata_${bucket} 
          WHERE vin = '${vinnumber}' 
            AND utctime >= ${starttime} 
            AND utctime <= ${endtime}
            AND longitude != 0
            AND latitude != 0`;
      });

      const canResults = [];
      const gpsResults = [];

      try {
        await Promise.all([
          // CAN
          ...canQueries.map((query) => {
            return new Promise((resolve, reject) => {
              this.clickHouseClient.queryWithCallback(query, (err, result) => {
                if (err) return reject(err);
                result.forEach((row) => {
                  canResults.push(row);
                });
                resolve();
              });
            });
          }),
          // GPS
          ...gpsQueries.map((query) => {
            return new Promise((resolve, reject) => {
              this.clickHouseClient.queryWithCallback(query, (err, result) => {
                if (err) return reject(err);
                result.forEach((row) => {
                  gpsResults.push(row);
                });
                resolve();
              });
            });
          }),
        ]);
      } catch (err) {
        const msg = String(err?.message || err);

        // ClickHouse unknown column/identifier messages to match:
        // e.g. "Unknown identifier", "Column ... doesn't exist", "Unknown column"
        if (err.type === "UNKNOWN_IDENTIFIER") {
          // Optional: try to extract the missing column name
          const unknowns = [
            ...msg.matchAll(
              /Unknown (?:expression )?identifier [`'"]?([a-zA-Z0-9_]+)[`'"]?/gi
            ),
            ...msg.matchAll(/Unknown column [`'"]?([a-zA-Z0-9_]+)[`'"]?/gi),
          ].map((m) => m[1]);

          const missing = Array.from(
            new Set(unknowns.filter((p) => canparams.includes(p)))
          );

          const detail =
            missing.length > 0
              ? `Invalid parameters found: ${missing.join(", ")}`
              : `Invalid parameters found.`;

          return new Error(detail);
        }

        // Unknown error → bubble up
        throw err;
      }

      canResults.sort((a, b) => a.utctime - b.utctime);
      gpsResults.sort((a, b) => a.utctime - b.utctime);

      const formattedCanData = this.formatCANData(canResults);
      const formattedGpsData = this.formatGPSData(gpsResults);

      const mergedData = this.mergeCANWithGPS(
        formattedCanData,
        formattedGpsData
      );

      const finalData = mergedData.map((record) => ({
        ...record,
        modelcode: modelcode,
      }));

      return finalData;
    } catch (error) {
      this.logger.error("Error fetching merged CAN+GPS history data:", error);
      throw error;
    }
  }

  mergeCANWithGPS(canData, gpsData) {
    const sortedCanData = canData.sort((a, b) => a.utctime - b.utctime);
    const sortedGpsData = gpsData.sort((a, b) => a.utctime - b.utctime);

    const mergedData = [];
    let gpsIndex = 0;
    let currentGpsRecord = null;

    if (sortedGpsData.length > 0) {
      currentGpsRecord = sortedGpsData[0];
    }

    for (let i = 0; i < sortedCanData.length; i++) {
      const canRecord = sortedCanData[i];
      const canUtcTime = canRecord.utctime;

      while (
        gpsIndex < sortedGpsData.length &&
        sortedGpsData[gpsIndex].utctime <= canUtcTime
      ) {
        currentGpsRecord = sortedGpsData[gpsIndex];
        gpsIndex++;
      }

      if (!currentGpsRecord && sortedGpsData.length > 0) {
        currentGpsRecord = sortedGpsData[0];
      }

      const mergedRecord = { ...canRecord };

      if (currentGpsRecord) {
        mergedRecord.gpstime = currentGpsRecord.gpstime;
        mergedRecord.latdir = currentGpsRecord.latdir;
        mergedRecord.latitude = currentGpsRecord.latitude;
        mergedRecord.longdir = currentGpsRecord.longdir;
        mergedRecord.longitude = currentGpsRecord.longitude;
      } else {
        mergedRecord.gpstime = null;
        mergedRecord.latdir = null;
        mergedRecord.latitude = null;
        mergedRecord.longdir = null;
        mergedRecord.longitude = null;
      }

      mergedData.push(mergedRecord);
    }

    return mergedData;
  }

  // async getLastestLatLongDataForVins(vinnos) {
  //   if (!vinnos || vinnos.length === 0) {
  //     return {};
  //   }

  //   try {
  //     const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
  //     const query = `
  //       SELECT vin, utctime, gpstime, latitude, longitude
  //       FROM lmmdata_latest.gpsdatalatest
  //       WHERE vin IN (${vinList});
  //     `;

  //     const result = await this.clickHouseClient.query(query);

  //     if (!result.success) {
  //       this.logger.error(
  //         "Failed to query ClickHouse for GPS data:",
  //         result.error
  //       );
  //       throw new Error("Failed to fetch latest GPS data");
  //     }

  //     const gpsDataMap = {};
  //     for (let row of result.data) {
  //       gpsDataMap[row.vin] = {
  //         latitude: row.latitude,
  //         longitude: row.longitude,
  //         utctime: row.utctime,
  //         gpstime: row.gpstime,
  //       };
  //     }

  //     return gpsDataMap;
  //   } catch (error) {
  //     this.logger.error("Error fetching latest GPS data:", error);
  //     return error;
  //   }
  // }

  async getLastestLatLongDataForVins(vinnos) {
    if (!vinnos || vinnos.length === 0) {
      return {};
    }

    // Fetch from Redis cache
    const cachedGpsDataMap = {};
    for (let vin of vinnos) {
      const redisKey = `gpsinfo.${vin}`;
      const [cachedData, redisError] = await this.redisSvc.get(redisKey);
      if (redisError) {
        this.logger.error("Redis error:", redisError, { redisKey: redisKey });
      } else if (cachedData !== null) {
        const parsed = JSON.parse(cachedData);
        // Ensure utctime and gpstime are integers for comparison
        if (parsed.utctime !== undefined) {
          parsed.utctime = parseInt(parsed.utctime) || 0;
        }
        if (parsed.gpstime !== undefined) {
          parsed.gpstime = parseInt(parsed.gpstime) || 0;
        }
        cachedGpsDataMap[vin] = parsed;
      }
    }

    try {
      // Fetch from ClickHouse
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const query = `
        SELECT vin, utctime, gpstime, latitude, longitude 
        FROM lmmdata_latest.gpsdatalatest
        WHERE vin IN (${vinList});
      `;

      const result = await this.clickHouseClient.query(query);

      if (!result.success) {
        this.logger.error(
          "Failed to query ClickHouse for GPS data:",
          result.error
        );
        throw new Error("Failed to fetch latest GPS data");
      }

      const clickHouseDataMap = {};
      for (let row of result.data) {
        clickHouseDataMap[row.vin] = {
          latitude: row.latitude,
          longitude: row.longitude,
          utctime: parseInt(row.utctime) || 0,
          gpstime: parseInt(row.gpstime) || 0,
        };
      }

      // Merge both sources and return the latest for each VIN
      const gpsDataMap = {};
      for (let vin of vinnos) {
        const cachedData = cachedGpsDataMap[vin];
        const clickHouseData = clickHouseDataMap[vin];

        if (cachedData && clickHouseData) {
          // Both sources have data - compare utctime and return the latest
          const cachedUtctime = cachedData.utctime || 0;
          const clickHouseUtctime = clickHouseData.utctime || 0;

          if (cachedUtctime >= clickHouseUtctime) {
            // Return cached data with only the required fields
            gpsDataMap[vin] = {
              latitude: cachedData.latitude,
              longitude: cachedData.longitude,
              utctime: cachedData.utctime,
              gpstime: cachedData.gpstime,
            };
          } else {
            // Return ClickHouse data
            gpsDataMap[vin] = clickHouseData;
          }
        } else if (cachedData) {
          // Only Redis has data - return with required fields only
          gpsDataMap[vin] = {
            latitude: cachedData.latitude,
            longitude: cachedData.longitude,
            utctime: cachedData.utctime,
            gpstime: cachedData.gpstime,
          };
        } else if (clickHouseData) {
          // Only ClickHouse has data
          gpsDataMap[vin] = clickHouseData;
        }
        // If neither has data, skip this VIN (won't be in the map)
      }

      return gpsDataMap;
    } catch (error) {
      this.logger.error("Error fetching latest GPS data:", error);
      return error;
    }
  }

  // async getLatestCanData(vinnos) {
  //   try {
  //     const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
  //     const query = `
  //       SELECT * FROM lmmdata_latest.candatalatest
  //       WHERE vin IN (${vinList})
  //     `;

  //     const result = await this.clickHouseClient.query(query);

  //     if (!result.success) {
  //       this.logger.error(
  //         "Failed to query ClickHouse for GPS data:",
  //         result.error
  //       );
  //       throw new Error("Failed to fetch latest CAN data");
  //     }

  //     const canDataMap = {};
  //     for (let row of result.data) {
  //       const formatted = { ...row };

  //       if (formatted.utctime !== undefined)
  //         formatted.utctime = parseInt(formatted.utctime) || 0;
  //       if (formatted.intime !== undefined)
  //         formatted.intime = parseInt(formatted.intime) || 0;
  //       if (formatted.proctime !== undefined)
  //         formatted.proctime = parseInt(formatted.proctime) || 0;

  //       const uint32Fields = [
  //         "bms_cyclenum",
  //         "can_soc",
  //         "soh",
  //         "brake_switch_status",
  //         "e_motor_rpm",
  //         "inv_drivemode_shift",
  //         "v_mode",
  //         "battery_ttc",
  //         "can_dte",
  //         "can_throttle",
  //         "veh_immo_resp",
  //         "service_tt",
  //         "chargett",
  //         "connectionhealthtt",
  //         "tcu_speedmode",
  //       ];
  //       uint32Fields.forEach((field) => {
  //         if (formatted[field] !== undefined) {
  //           formatted[field] = parseInt(formatted[field]) || 0;
  //         }
  //       });

  //       const float32Fields = [
  //         "charger_temp_live",
  //         "chargertemp",
  //         "soc",
  //         "bms_cell_avg_volt",
  //         "bms_cell_avg_temp",
  //         "motortemp",
  //         "bms_batt_pack_temp",
  //         "odometer",
  //         "odometer_new",
  //         "vehiclespeed",
  //         "motorpower",
  //         "percthrottle",
  //         "kwh",
  //         "batt_current",
  //         "aux_batt_volt",
  //         "bat_voltage",
  //         "dte",
  //         "wakeup_command",
  //       ];
  //       float32Fields.forEach((field) => {
  //         if (formatted[field] !== undefined) {
  //           formatted[field] = parseFloat(formatted[field]) || 0;
  //         }
  //       });

  //       canDataMap[row.vin] = formatted;
  //     }

  //     return canDataMap;
  //   } catch (error) {
  //     this.logger.error("Error fetching latest vehicle data:", error);
  //     throw error;
  //   }
  // }

  async getLatestCanData(vinnos) {
    try {
      // Fetch from Redis cache
      const cachedCanDataMap = {};
      for (let vin of vinnos) {
        const redisKey = `caninfo.${vin}`;
        const [cachedData, redisError] = await this.redisSvc.get(redisKey);
        if (redisError) {
          this.logger.error("Redis error:", redisError, { redisKey: redisKey });
        } else if (cachedData !== null) {
          const parsed = JSON.parse(cachedData);
          // Ensure utctime is an integer for comparison
          if (parsed.utctime !== undefined) {
            parsed.utctime = parseInt(parsed.utctime) || 0;
          }
          cachedCanDataMap[vin] = parsed;
        }
      }

      // Fetch from ClickHouse
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const query = `
        SELECT * FROM lmmdata_latest.candatalatest
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

      const clickHouseDataMap = {};
      for (let row of result.data) {
        const formatted = { ...row };

        if (formatted.utctime !== undefined)
          formatted.utctime = parseInt(formatted.utctime) || 0;
        if (formatted.intime !== undefined)
          formatted.intime = parseInt(formatted.intime) || 0;
        if (formatted.proctime !== undefined)
          formatted.proctime = parseInt(formatted.proctime) || 0;

        const uint32Fields = [
          "bms_cyclenum",
          "can_soc",
          "soh",
          "brake_switch_status",
          "e_motor_rpm",
          "inv_drivemode_shift",
          "v_mode",
          "battery_ttc",
          "can_dte",
          "can_throttle",
          "veh_immo_resp",
          "service_tt",
          "chargett",
          "connectionhealthtt",
          "tcu_speedmode",
        ];
        uint32Fields.forEach((field) => {
          if (formatted[field] !== undefined) {
            formatted[field] = parseInt(formatted[field]) || 0;
          }
        });

        const float32Fields = [
          "charger_temp_live",
          "chargertemp",
          "soc",
          "bms_cell_avg_volt",
          "bms_cell_avg_temp",
          "motortemp",
          "bms_batt_pack_temp",
          "odometer",
          "odometer_new",
          "vehiclespeed",
          "motorpower",
          "percthrottle",
          "kwh",
          "batt_current",
          "aux_batt_volt",
          "bat_voltage",
          "dte",
          "wakeup_command",
        ];
        float32Fields.forEach((field) => {
          if (formatted[field] !== undefined) {
            formatted[field] = parseFloat(formatted[field]) || 0;
          }
        });

        clickHouseDataMap[row.vin] = formatted;
      }

      // Merge both sources and return the latest for each VIN
      const canDataMap = {};
      for (let vin of vinnos) {
        const cachedData = cachedCanDataMap[vin];
        const clickHouseData = clickHouseDataMap[vin];

        if (cachedData && clickHouseData) {
          // Both sources have data - compare utctime and return the latest
          const cachedUtctime = cachedData.utctime || 0;
          const clickHouseUtctime = clickHouseData.utctime || 0;
          canDataMap[vin] =
            cachedUtctime >= clickHouseUtctime ? cachedData : clickHouseData;
        } else if (cachedData) {
          // Only Redis has data
          canDataMap[vin] = cachedData;
        } else if (clickHouseData) {
          // Only ClickHouse has data
          canDataMap[vin] = clickHouseData;
        }
        // If neither has data, skip this VIN (won't be in the map)
      }

      return canDataMap;
    } catch (error) {
      this.logger.error("Error fetching latest vehicle data:", error);
      throw error;
    }
  }

  async getVinNoFromRegNo(regnos) {
    try {
      if (!regnos || !Array.isArray(regnos) || regnos.length === 0) {
        return [];
      }
      const normalizedRegnos = regnos.map((regno) =>
        regno.trim().toUpperCase()
      );
      // Build placeholders for each registration number
      const query = `
        SELECT vinno, UPPER(TRIM(license_plate)) as regno FROM vehicle WHERE UPPER(TRIM(license_plate)) = ANY($1::text[])
      `;
      const result = await this.pgPoolI.Query(query, [normalizedRegnos]);
      if (result.rowCount === 0) {
        return {
          vinnos: [],
          missingRegnos: normalizedRegnos,
        };
      }
      let missingRegnos = [];
      if (result.rows.length !== normalizedRegnos.length) {
        missingRegnos = normalizedRegnos.filter(
          (regno) => !result.rows.some((row) => row.regno === regno)
        );
      }
      return {
        vinnos: result.rows.map((row) => row.vinno),
        missingRegnos: missingRegnos,
      };
    } catch (error) {
      this.logger.error(
        "Error fetching VIN numbers from registration numbers:",
        error
      );
      throw error;
    }
  }

  async getVehicleLastConnectedData(vinnos) {
    try {
      // Fetch from Redis cache
      const cachedCanDataMap = {};
      const cachedGpsDataMap = {};
      for (let vin of vinnos) {
        const redisCanKey = `caninfo.${vin}`;
        const redisGpsKey = `gpsinfo.${vin}`;
        const [cachedCanData, redisCanError] = await this.redisSvc.get(
          redisCanKey
        );
        const [cachedGpsData, redisGpsError] = await this.redisSvc.get(
          redisGpsKey
        );
        if (redisCanError) {
          this.logger.error("Redis error:", redisCanError, {
            redisCanKey: redisCanKey,
          });
        }
        if (redisGpsError) {
          this.logger.error("Redis error:", redisGpsError, {
            redisGpsKey: redisGpsKey,
          });
        }
        if (cachedCanData !== null) {
          const parsedCanData = JSON.parse(cachedCanData);
          if (parsedCanData.utctime !== undefined) {
            parsedCanData.utctime = parseInt(parsedCanData.utctime) || 0;
          }
          cachedCanDataMap[vin] = parsedCanData.utctime;
        }
        if (cachedGpsData !== null) {
          const parsedGpsData = JSON.parse(cachedGpsData);
          if (parsedGpsData.utctime !== undefined) {
            parsedGpsData.utctime = parseInt(parsedGpsData.utctime) || 0;
          }
          cachedGpsDataMap[vin] = {
            utctime: parsedGpsData.utctime,
            lat: parsedGpsData.latitude,
            lng: parsedGpsData.longitude,
          };
        }
      }
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const canQuery = `
        SELECT vin, utctime FROM lmmdata_latest.candatalatest
        WHERE vin IN (${vinList})
      `;

      const canResult = await this.clickHouseClient.query(canQuery);

      if (!canResult.success) {
        this.logger.error(
          "Failed to query ClickHouse for CAN data:",
          canResult.error
        );
        throw new Error("Failed to fetch latest CAN data");
      }

      const gpsQuery = `
        SELECT vin, utctime, latitude, longitude FROM lmmdata_latest.gpsdatalatest
        WHERE vin IN (${vinList})
      `;
      const gpsResult = await this.clickHouseClient.query(gpsQuery);
      if (!gpsResult.success) {
        this.logger.error(
          "Failed to query ClickHouse for GPS data:",
          gpsResult.error
        );
        throw new Error("Failed to fetch latest GPS data");
      }
      const canDataMap = {};
      for (let row of canResult.data) {
        canDataMap[row.vin] = parseInt(row.utctime) || 0;
      }
      const gpsDataMap = {};
      for (let row of gpsResult.data) {
        const parsedutctime = parseInt(row.utctime) || 0;
        const parsedlatitude = parseFloat(row.latitude) || 0;
        const parsedlongitude = parseFloat(row.longitude) || 0;
        gpsDataMap[row.vin] = {
          utctime: parsedutctime,
          lat: parsedlatitude,
          lng: parsedlongitude,
        };
      }
      const latestdata = {};
      for (let vin of vinnos) {
        const cachedCanUtcTime = cachedCanDataMap[vin];
        const cachedGpsData = cachedGpsDataMap[vin];
        const canUtcTime = canDataMap[vin];
        const gpsUtcTime = gpsDataMap[vin];
        let latestgpsdata = {};
        if (cachedGpsData && gpsUtcTime) {
          if (cachedGpsData.utctime > gpsUtcTime.utctime) {
            latestgpsdata = {
              utctime: cachedGpsData.utctime,
              lat: cachedGpsData.lat,
              lng: cachedGpsData.lng,
            };
          } else {
            latestgpsdata = {
              utctime: gpsUtcTime.utctime,
              lat: gpsUtcTime.lat,
              lng: gpsUtcTime.lng,
            };
          }
        } else if (cachedGpsData) {
          latestgpsdata = {
            utctime: cachedGpsData.utctime,
            lat: cachedGpsData.lat,
            lng: cachedGpsData.lng,
          };
        } else if (gpsUtcTime) {
          latestgpsdata = {
            utctime: gpsUtcTime.utctime,
            lat: gpsUtcTime.lat,
            lng: gpsUtcTime.lng,
          };
        } else {
          latestgpsdata = {
            utctime: "NA",
            lat: "NA",
            lng: "NA",
          };
        }
        let canutctime = "NA";
        if (cachedCanUtcTime && canUtcTime) {
          canutctime = Math.max(cachedCanUtcTime, canUtcTime);
        } else if (cachedCanUtcTime) {
          canutctime = cachedCanUtcTime;
        } else if (canUtcTime) {
          canutctime = canUtcTime;
        }
        latestdata[vin] = {
          can: { utctime: canutctime },
          gps: latestgpsdata,
        };
      }
      return latestdata;
    } catch (error) {
      this.logger.error("Error fetching vehicle last connected data:", error);
      throw error;
    }
  }

  async getVehicleAccountDetails(vinnos) {
    try {
      if (!vinnos || !Array.isArray(vinnos) || vinnos.length === 0) {
        return [];
      }
      let query = `
        SELECT
          ft.name as fleetname,
          ft.fleetid as fleetid,
          a.accountid,
          a.accountname,
          v.vinno,
          COALESCE(v.license_plate, v.vinno) AS regno,
          v.vehicle_city,
          v.modelcode,
          v.delivered_date,
          v.createdat,
          u.displayname as assignedby,
          CASE 
            WHEN avs.state = 1 THEN 'SUBSCRIBED'
            ELSE 'NOT_SUBSCRIBED'
          END AS subscription_status
        FROM vehicle v
        JOIN fleet_vehicle fv 
          ON v.vinno = fv.vinno 
        AND fv.isowner = true
        JOIN fleet_tree ft ON fv.accountid = ft.accountid AND fv.fleetid = ft.fleetid
        JOIN users u ON fv.assignedby = u.userid
        JOIN account a ON fv.accountid = a.accountid
        LEFT JOIN account_vehicle_subscription avs 
          ON fv.accountid = avs.accountid 
        AND v.vinno = avs.vinno
        WHERE v.vinno = ANY($1::text[])
      `;
      let result = await this.pgPoolI.Query(query, [vinnos]);
      if (result.rowCount === 0) {
        return [];
      }
      const taggedvehiclesQuery = `SELECT 
                                    tv.vinno,  
                                    a.accountid, 
                                    a.accountname,
                                    CASE 
                                      WHEN avs.state = 1 THEN a.accountname || ' - SUBSCRIBED'
                                      ELSE a.accountname || ' - NOT_SUBSCRIBED'
                                    END AS subscription_status
                                  FROM tagged_vehicle tv 
                                  JOIN account a 
                                    ON tv.dstaccountid = a.accountid 
                                  LEFT JOIN account_vehicle_subscription avs 
                                    ON tv.dstaccountid = avs.accountid 
                                  AND tv.vinno = avs.vinno
                                  WHERE tv.vinno = ANY($1::text[]) AND tv.isactive = true
                                `;
      let taggedvehicles = await this.pgPoolI.Query(taggedvehiclesQuery, [
        vinnos,
      ]);
      let taggedvehiclesMap = new Map();
      for (let row of taggedvehicles.rows) {
        if (!taggedvehiclesMap.has(row.vinno)) {
          taggedvehiclesMap.set(row.vinno, []);
        }
        taggedvehiclesMap.get(row.vinno).push(row);
      }

      let accountDetailMap = new Map();
      for (let row of result.rows) {
        accountDetailMap.set(row.vinno, {
          account: row,
          taggedvehicle: taggedvehiclesMap.get(row.vinno) || "NA",
        });
      }

      return accountDetailMap;
    } catch (error) {
      this.logger.error("Error fetching vehicle account details:", error);
      throw error;
    }
  }
}
