import {
  formatEpochToDuration,
  formatEpochToDateTime,
  toFormattedString,
} from "../../../utils/epochconverter.js";
import { BATTERY_THRESOLD } from "../../../utils/constant.js";

export default class ChargeinsightshdlrImpl {
  constructor(chargeinsightssvcI, fmsAccountSvcI, tripsinsightssvcI, logger) {
    this.chargeinsightssvcI = chargeinsightssvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.logger = logger;
    this.tripsinsightssvcI = tripsinsightssvcI;
    this.BATTERY_THRESOLD = BATTERY_THRESOLD;
  }

  GetChargeInsightsByVehicleLogic = async (
    accountid,
    vinno,
    starttime,
    endtime
  ) => {
    let result = await this.chargeinsightssvcI.GetChargeInsightsByVehicle(
      accountid,
      vinno,
      starttime,
      endtime
    );

    if (!result) {
      this.logger.error("Failed to get vehicle charge insights data");
      throw new Error("Failed to get vehicle charge insights data");
    }

    let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
    let vehicles = [];
    if (rootFleetId) {
      vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        rootFleetId,
        true
      );
    }

    const vehicle = vehicles.find((v) => v.vinno === vinno);
    const modeldisplayname = vehicle?.modeldisplayname || "Unknown Model";

    const regnoData = await this.fmsAccountSvcI.GetRegno([vinno]);
    const {vinToRegnoMap, vinToCapacityMap} = this.vinToLicenceAndModelinfoMapping(regnoData);

    if (Array.isArray(result)) {
      result = result.map((charge) => {
        const socgained = charge.endsoc - charge.startsoc;

        const chargingduration =
          charge.chargingtime || charge.endtime - charge.starttime;

        const unitgained = this.calculateUnitGained(
          charge.startkwh,
          charge.endkwh
        );
        const capacity = vinToCapacityMap[vinno];
        if (this.unitGainedThresoldCheck(unitgained, capacity)) {
          this.logger.info(
            `Skipping charge session with unitgained(${unitgained} kWh) > batterycapacity(${capacity}) && unitgained(${unitgained} kWh) > tresold(20 kWh) for vin: ${vinno}`
          );
          return;
        }

        const tempchange = charge.endtemp - charge.starttemp;

        const dtechange = charge.enddte - charge.startdte;

        const chargingtype = charge.isfastcharging
          ? "Fast Charging"
          : "Slow Charging";

        const chargingrate =
          chargingduration > 0 ? socgained / (chargingduration / 3600000) : 0;

        return {
          ...charge,
          regno: vinToRegnoMap[vinno] || `${vinno}`,
          modeldisplayname: modeldisplayname,
          socgained: Math.round(socgained * 100) / 100,
          chargingduration: Math.round(chargingduration * 100) / 100,
          unitgained: Math.round(unitgained * 100) / 100,
          tempchange: Math.round(tempchange * 100) / 100,
          dtechange: Math.round(dtechange * 100) / 100,
          chargingtype: chargingtype,
          chargingrate: Math.round(chargingrate * 100) / 100,
          socgainedpercent: `${Math.round(socgained * 100) / 100}%`,
          chargingdurationformatted: formatEpochToDuration(chargingduration),
          unitgainedformatted: `${Math.round(unitgained * 100) / 100} kWh`,
          tempchangeformatted: `${tempchange > 0 ? "+" : ""}${
            Math.round(tempchange * 100) / 100
          }°C`,
          dtechangeformatted: `${dtechange > 0 ? "+" : ""}${
            Math.round(dtechange * 100) / 100
          } km`,
          chargingrateformatted: `${
            Math.round(chargingrate * 100) / 100
          }%/hour`,
          startsocpercent: `${charge.startsoc}%`,
          endsocpercent: `${charge.endsoc}%`,
          maxcurrentformatted: `${Math.round(charge.maxcurrent * 100) / 100} A`,
          maxvoltageformatted: `${Math.round(charge.maxvoltage * 100) / 100} V`,
          maxbatttempformatted: `${charge.maxbattemp}°C`,
        };
      });
    }

    return result;
  };

  GetChargeInsightsByFleetLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive = false
  ) => {
    let vehicles = await this.fmsAccountSvcI.GetVehicles(
      accountid,
      fleetid,
      recursive
    );
    if (!vehicles || vehicles.length === 0) {
      this.logger.info("No vehicles found in the fleet");
      return [];
    }

    const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);

    let [result, regnoData] = await Promise.all([
      this.chargeinsightssvcI.GetChargeInsightsByFleet(
        accountid,
        vinNumbers,
        starttime,
        endtime
      ),
      this.fmsAccountSvcI.GetRegno(vinNumbers),
    ]);

    if (!result) {
      this.logger.error("Failed to get fleet charge insights data");
      throw new Error("Failed to get fleet charge insights data");
    }

    const {vinToRegnoMap, vinToCapacityMap} = this.vinToLicenceAndModelinfoMapping(regnoData);

    const vinToModelDisplayNameMap = {};
    vehicles.forEach((vehicle) => {
      vinToModelDisplayNameMap[vehicle.vinno] =
        vehicle.modeldisplayname || "Unknown Model";
    });

    if (Array.isArray(result)) {
      result = result.map((charge) => {
        const socgained = charge.endsoc - charge.startsoc;

        const chargingduration =
          charge.chargingtime || charge.endtime - charge.starttime;

        // Calculate unitgained
        const unitgained = this.calculateUnitGained(
          charge.startkwh,
          charge.endkwh
        );
        const capacity = vinToCapacityMap[charge.vin];
        if (this.unitGainedThresoldCheck(unitgained, capacity)) {
          this.logger.info(
            `Skipping charge session with unitgained(${unitgained} kWh) > batterycapacity(${capacity}) && unitgained(${unitgained} kWh) > tresold(20 kWh) for vin: ${charge.vin}`
          );
          return;
        }
        const tempchange = charge.endtemp - charge.starttemp;

        const dtechange = charge.enddte - charge.startdte;

        const chargingtype = charge.isfastcharging
          ? "Fast Charging"
          : "Slow Charging";

        const chargingrate =
          chargingduration > 0 ? socgained / (chargingduration / 3600000) : 0;

        return {
          ...charge,
          regno: vinToRegnoMap[charge.vin] || `${charge.vin}`,
          modeldisplayname:
            vinToModelDisplayNameMap[charge.vin] || "Unknown Model",
          socgained: Math.round(socgained * 100) / 100,
          chargingduration: Math.round(chargingduration * 100) / 100,
          unitgained: Math.round(unitgained * 100) / 100,
          tempchange: Math.round(tempchange * 100) / 100,
          dtechange: Math.round(dtechange * 100) / 100,
          chargingtype: chargingtype,
          chargingrate: Math.round(chargingrate * 100) / 100,
          socgainedpercent: `${Math.round(socgained * 100) / 100}%`,
          chargingdurationformatted: formatEpochToDuration(chargingduration),
          unitgainedformatted: `${Math.round(unitgained * 100) / 100} kWh`,
          tempchangeformatted: `${tempchange > 0 ? "+" : ""}${
            Math.round(tempchange * 100) / 100
          }°C`,
          dtechangeformatted: `${dtechange > 0 ? "+" : ""}${
            Math.round(dtechange * 100) / 100
          } km`,
          chargingrateformatted: `${
            Math.round(chargingrate * 100) / 100
          }%/hour`,
          startsocpercent: `${charge.startsoc}%`,
          endsocpercent: `${charge.endsoc}%`,
          maxcurrentformatted: `${Math.round(charge.maxcurrent * 100) / 100} A`,
          maxvoltageformatted: `${Math.round(charge.maxvoltage * 100) / 100} V`,
          maxbatttempformatted: `${charge.maxbattemp}°C`,
        };
      });
    }

    return result;
  };

  GetChargeDistributionByVehicleLogic = async (accountid, vinno, timestamp) => {
    try {
      const date = new Date(parseInt(timestamp));
      const startOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const starttime = startOfDay.getTime();
      const endtime = endOfDay.getTime();

      const chargeData =
        await this.chargeinsightssvcI.GetChargeInsightsByVehicle(
          accountid,
          vinno,
          starttime,
          endtime
        );

      if (!chargeData || chargeData.length === 0) {
        return {
          totalchargingevents: 0,
          totalvehicles: 1,
          hourlydistribution: this.initializeHourlyBuckets(),
          durationdistribution: this.initializeDurationBuckets(),
        };
      }

      const hourlydistribution = this.calculateHourlyDistribution(chargeData);

      const durationdistribution =
        this.calculateDurationDistribution(chargeData);

      return {
        totalchargingevents: chargeData.length,
        totalvehicles: 1,
        hourlydistribution,
        durationdistribution,
      };
    } catch (err) {
      this.logger.error("Error in GetChargeDistributionByVehicle:", err);
      throw err;
    }
  };

  GetChargeDistributionByFleetLogic = async (
    accountid,
    fleetid,
    timestamp,
    recursive = false
  ) => {
    try {
      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      );
      if (!vehicles || vehicles.length === 0) {
        return {
          totalchargingevents: 0,
          totalvehicles: 0,
          hourlydistribution: this.initializeHourlyBuckets(),
          durationdistribution: this.initializeDurationBuckets(),
        };
      }

      const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);

      const date = new Date(parseInt(timestamp));
      const startOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const starttime = startOfDay.getTime();
      const endtime = endOfDay.getTime();

      const chargeData = await this.chargeinsightssvcI.GetChargeInsightsByFleet(
        accountid,
        vinNumbers,
        starttime,
        endtime
      );

      if (!chargeData || chargeData.length === 0) {
        return {
          hourlyDistribution: this.initializeHourlyBuckets(),
          durationDistribution: this.initializeDurationBuckets(),
        };
      }

      const hourlydistribution = this.calculateHourlyDistribution(chargeData);

      const durationdistribution =
        this.calculateDurationDistribution(chargeData);

      return {
        totalchargingevents: chargeData.length,
        totalvehicles: vinNumbers.length,
        hourlydistribution,
        durationdistribution,
      };
    } catch (err) {
      this.logger.error("Error in GetChargeDistributionByFleet:", err);
      throw err;
    }
  };

  initializeHourlyBuckets = () => {
    const hourlyBuckets = {};
    for (let i = 0; i < 24; i++) {
      hourlyBuckets[i] = 0;
    }
    return hourlyBuckets;
  };

  initializeDurationBuckets = () => {
    return {
      less_than_30min: 0,
      "30min_to_1hr": 0,
      "1hr_to_2hr": 0,
      "2hr_to_4hr": 0,
      "4hr_to_8hr": 0,
      "8hr_plus": 0,
    };
  };

  calculateHourlyDistribution = (chargeData) => {
    const hourlyDistribution = this.initializeHourlyBuckets();

    chargeData.forEach((charge) => {
      if (charge.starttime) {
        const chargeDate = new Date(parseInt(charge.starttime));
        const hour = chargeDate.getHours();
        hourlyDistribution[hour]++;
      }
    });

    return hourlyDistribution;
  };

  calculateDurationDistribution = (chargeData) => {
    const durationdistribution = this.initializeDurationBuckets();

    chargeData.forEach((charge) => {
      if (charge.chargingtime) {
        const durationInMinutes = charge.chargingtime / (1000 * 60);

        if (durationInMinutes < 30) {
          durationdistribution.less_than_30min++;
        } else if (durationInMinutes >= 30 && durationInMinutes < 60) {
          durationdistribution["30min_to_1hr"]++;
        } else if (durationInMinutes >= 60 && durationInMinutes < 120) {
          durationdistribution["1hr_to_2hr"]++;
        } else if (durationInMinutes >= 120 && durationInMinutes < 240) {
          durationdistribution["2hr_to_4hr"]++;
        } else if (durationInMinutes >= 240 && durationInMinutes < 480) {
          durationdistribution["4hr_to_8hr"]++;
        } else {
          durationdistribution["8hr_plus"]++;
        }
      }
    });

    return durationdistribution;
  };

  calculateUnitGained = (startKwh, endKwh) => {
    if (startKwh == null || endKwh == null) return null;
    if (!Number.isFinite(startKwh) || !Number.isFinite(endKwh)) return null; // 0 passes
    return Math.abs(endKwh - startKwh);
  };

  vinToLicenceAndModelinfoMapping = (regnoData)=>{
    const vinToRegnoMap={};
    const vinToCapacityMap={};
    regnoData.forEach(({ vinno, license_plate, modelinfo }) => {
      if (license_plate && license_plate.trim() !== "") {
        vinToRegnoMap[vinno] = license_plate;
      } else {
        vinToRegnoMap[vinno] = `${vinno}`;
      }

      const rawCap = modelinfo?.brochurespecs?.battery_capacity;
      const capNum =
        typeof rawCap === "number"
          ? rawCap
          : typeof rawCap === "string"
          ? parseFloat(rawCap)
          : undefined;
      if (typeof capNum === "number" && !Number.isNaN(capNum)) {
        vinToCapacityMap[vinno] = capNum;
      }
    });
    return {
      vinToRegnoMap,
      vinToCapacityMap
    }
  }

  unitGainedThresoldCheck = (unitgained, batteryCapacity) =>{
    return (unitgained > batteryCapacity && unitgained > BATTERY_THRESOLD);
  }

  GetVehicleChargeInsightsLogic = async (
    accountid,
    vinno,
    starttime,
    endtime
  ) => {
    try {
      let vinNumbers;
      if (vinno) {
        vinNumbers = Array.isArray(vinno)
          ? vinno
          : vinno.includes(",")
          ? vinno.split(",")
          : [vinno];
      } else {
        throw new Error("Vin number is required");
      }

      if (vinNumbers.length === 0) {
        return {
          totalchargesessions: "0",
          totalchargingduration: "0min",
          totalenergygained: "0 kWh",
          vehicles: {},
        };
      }

      const result = await this.ProcessChargeData(
        accountid,
        vinNumbers,
        starttime,
        endtime
      );

      return result;
    } catch (error) {
      this.logger.error("Error in GetVehicleChargeInsightsLogic:", error);
      throw error;
    }
  };

  GetFleetChargeInsightsLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive
  ) => {
    try {
      if (!fleetid) {
        throw new Error("Fleet ID is required");
      }

      const vehicles =
        (await this.fmsAccountSvcI.GetVehicles(
          accountid,
          fleetid,
          recursive
        )) || [];
      if (!vehicles || vehicles.length === 0) {
        return {
          totalchargesessions: "0",
          totalchargingduration: "0min",
          totalenergygained: "0 kWh",
          vehicles: {},
        };
      }

      const vinNumbers = vehicles.map((v) => v.vinno);

      const result = await this.ProcessChargeData(
        accountid,
        vinNumbers,
        starttime,
        endtime
      );

      return result;
    } catch (error) {
      this.logger.error("Error in GetFleetChargeInsightsLogic:", error);
      throw error;
    }
  };

  safeToFixed = (val, limit = 6) => {
    return typeof val === "number" && !isNaN(val)
      ? parseFloat(val.toFixed(limit))
      : 0;
  };

  ProcessChargeData = async (accountid, vinNumbers, starttime, endtime) => {
    try {
      const [chargeData, regnoData] = await Promise.all([
        this.chargeinsightssvcI.GetChargeInsightsByFleet(
          accountid,
          vinNumbers,
          starttime,
          endtime
        ),
        this.fmsAccountSvcI.GetRegno(vinNumbers),
      ]);
      if (!chargeData || chargeData.length === 0) {
        return {
          totalchargingsessions: "0",
          totalchargingduration: "0min",
          totalenergygained: "0 kWh",
          vehicles: {},
        };
      }

      const {vinToRegnoMap, vinToCapacityMap} = this.vinToLicenceAndModelinfoMapping(regnoData);

      const BATCH_SIZE = 500;

      const batches = [];
      for (let i = 0; i < chargeData.length; i += BATCH_SIZE) {
        batches.push(chargeData.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(
        batches.map(async (batch) => {
          let batchVehicles = {};
          let batchTotalChargingSessions = 0;
          let batchTotalChargingDuration = 0;
          let batchTotalEnergyGained = 0;

          batch.forEach((charge) => {
            const vin = charge.vin;
            if (!vin) return;

            // Calculate session metrics
            const startEpoch = charge.starttime;
            const endEpoch = charge.endtime;
            const durationMs =
              endEpoch && startEpoch ? endEpoch - startEpoch : 0;
            const durationStr = formatEpochToDuration(durationMs);

            const isfastcharging = charge.isfastcharging;

            // Calculate unitgained
            const unitgained = this.calculateUnitGained(
              charge.startkwh,
              charge.endkwh
            );
            const capacity = vinToCapacityMap[vin];
            if (this.unitGainedThresoldCheck(unitgained, capacity)) {
              this.logger.info(
                `Skipping charge session with unitgained(${unitgained} kWh) > tresold(20 kWh) for vin: ${vin}`
              );
              return;
            }
            // Build session object
            const session = {
              starttime: formatEpochToDateTime(startEpoch),
              endtime: formatEpochToDateTime(endEpoch),
              startlat: this.safeToFixed(charge.startlat),
              endlat: this.safeToFixed(charge.endlat),
              startlng: this.safeToFixed(charge.startlng),
              endlng: this.safeToFixed(charge.endlng),
              startsoc: `${this.safeToFixed(charge.startsoc, 2)}%`,
              endsoc: `${this.safeToFixed(charge.endsoc, 2)}%`,
              duration: durationStr,
              unitgained: `${this.safeToFixed(unitgained, 2)} kWh`,
              isfastcharging: isfastcharging,
              // Add original epoch timestamp for sorting
              _startEpoch: startEpoch,
            };

            // Add to vehicles object
            if (!batchVehicles[vin]) {
              batchVehicles[vin] = { sessioncount: 0, sessions: [] };
            }
            batchVehicles[vin].sessioncount += 1;
            batchVehicles[vin].sessions.push(session);

            // Update batch totals
            batchTotalChargingSessions += 1;
            batchTotalEnergyGained += unitgained;
            batchTotalChargingDuration += durationMs;
          });

          return {
            batchVehicles,
            batchTotalChargingSessions,
            batchTotalEnergyGained,
            batchTotalChargingDuration,
          };
        })
      );

      // Aggregate all batch results
      let totalChargingSessions = 0;
      let totalEnergyGained = 0;
      let vehicles = {};
      let totalChargingDuration = 0;

      for (const result of batchResults) {
        totalChargingSessions += result.batchTotalChargingSessions;
        totalEnergyGained += result.batchTotalEnergyGained;
        totalChargingDuration += result.batchTotalChargingDuration;
        // Merge vehicles
        for (const vin in result.batchVehicles) {
          const regno = vinToRegnoMap[vin];
          if (!vehicles[vin]) {
            vehicles[vin] = { regno: regno, sessioncount: 0, sessions: [] };
          }
          vehicles[vin].regno = regno;
          vehicles[vin].sessioncount += result.batchVehicles[vin].sessioncount;
          vehicles[vin].sessions.push(...result.batchVehicles[vin].sessions);
        }
      }

      for (const vin in vehicles) {
        vehicles[vin].sessions.sort((a, b) => {
          // Use the original epoch timestamp for comparison
          return b._startEpoch - a._startEpoch; // Reverse order (newest first)
        });
        // Remove the temporary _startEpoch field after sorting
        vehicles[vin].sessions.forEach((session) => {
          delete session._startEpoch;
        });
      }

      return {
        totalchargingsessions: toFormattedString(totalChargingSessions),
        totalchargingduration: formatEpochToDuration(totalChargingDuration),
        totalenergygained: `${toFormattedString(totalEnergyGained)} kWh`,
        vehicles,
      };
    } catch (error) {
      this.logger.error("Error in ProcessChargeData:", error);
      throw error;
    }
  };

  toISTDateString = (timestamp) => {
    const date = new Date(timestamp); // IST offset
    const day = date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return day;
  };

  preprocessTripData = (tripData) => {
    const tripIndex = {};

    // Group trips by VIN and create time-based index
    tripData.forEach((trip) => {
      if (!tripIndex[trip.vin]) {
        tripIndex[trip.vin] = [];
      }
      tripIndex[trip.vin].push({
        starttime: trip.starttime,
        endtime: trip.endtime,
      });
    });

    // Sort trips by start time for each VIN for faster lookup
    Object.keys(tripIndex).forEach((vin) => {
      tripIndex[vin].sort((a, b) => a.starttime - b.starttime);
    });

    return tripIndex;
  };

  // Optimized method to find trips in time window
  findTripsInWindow = (tripIndex, vin, startTime, endTime) => {
    const tripsForVin = tripIndex[vin] || [];

    // Binary search for faster lookup
    let left = 0;
    let right = tripsForVin.length - 1;
    let foundTrips = [];

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const trip = tripsForVin[mid];

      // Check if trip overlaps with time window
      if (trip.starttime < endTime && trip.endtime > startTime) {
        foundTrips.push(trip);

        // Check adjacent trips for more matches
        let i = mid - 1;
        while (
          i >= 0 &&
          tripsForVin[i].starttime < endTime &&
          tripsForVin[i].endtime > startTime
        ) {
          foundTrips.unshift(tripsForVin[i]);
          i--;
        }

        i = mid + 1;
        while (
          i < tripsForVin.length &&
          tripsForVin[i].starttime < endTime &&
          tripsForVin[i].endtime > startTime
        ) {
          foundTrips.push(tripsForVin[i]);
          i++;
        }
        break;
      }

      if (trip.endtime <= startTime) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return foundTrips;
  };


  groupSessionsByDate = async (chargeData) => {
    const sessionsByDate = {};

    // Process sessions in parallel batches
    const BATCH_SIZE = 1000; // Process 1000 sessions at a time
    const batches = [];

    for (let i = 0; i < chargeData.length; i += BATCH_SIZE) {
      batches.push(chargeData.slice(i, i + BATCH_SIZE));
    }

    const batchPromises = batches.map(async (batch) => {
      const batchResult = {};
      for (const session of batch) {
        const dateKey = this.toISTDateString(session.starttime);
        if (!batchResult[dateKey]) batchResult[dateKey] = [];
        batchResult[dateKey].push(session);
      }
      return batchResult;
    });

    const batchResults = await Promise.all(batchPromises);

    // Merge all batch results
    for (const batchResult of batchResults) {
      for (const [dateKey, sessions] of Object.entries(batchResult)) {
        if (!sessionsByDate[dateKey]) sessionsByDate[dateKey] = [];
        sessionsByDate[dateKey].push(...sessions);
      }
    }

    return sessionsByDate;
  };

// ... existing code ...

  // Common function to fetch and prepare base data
  getFleetChargeInsightsBaseData = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive
  ) => {
    if (!fleetid) throw new Error("Fleet ID is required");

    const vehicles =
      (await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      )) || [];
    
    if (!vehicles || vehicles.length === 0) {
      return {
        vehicles: [],
        vinNumbers: [],
        vinregnoMap: {},
        chargeData: [],
        tripData: [],
        tripIndex: {},
        totalvehicles: 0,
      };
    }

    const vinNumbers = vehicles.map((v) => v.vinno);
    const vinregnoMap = {};
    vehicles.forEach((v) => {
      vinregnoMap[v.vinno] = v.regno;
    });

    const [chargeData, tripData] = await Promise.all([
      this.chargeinsightssvcI.GetChargeInsightsByFleet(
        accountid,
        vinNumbers,
        starttime,
        endtime
      ),
      this.tripsinsightssvcI.GetTripsByFleet(vinNumbers, starttime, endtime),
    ]);

    const tripIndex = this.preprocessTripData(tripData || []);

    return {
      vehicles,
      vinNumbers,
      vinregnoMap,
      chargeData: chargeData || [],
      tripData: tripData || [],
      tripIndex,
      totalvehicles: vehicles.length,
    };
  };

  // Unified category matching logic - use this everywhere
  matchesCategory = (session, category, tripIndex) => {
    const duration = session.chargingtime || (session.endtime - session.starttime);
    const durationMins = duration / (60 * 1000); // Convert to minutes
    const durationSecs = duration / 1000; // Convert to seconds

    switch (category) {
      case "chargebehaviorviolation":
        // Charging > 60 minutes after reaching 100% SoC
        return session.endsoc === 100 && durationMins > 60;

      case "intermittentcharging":
        // Charging between 20-80% SoC (partial charging)
        return (
          session.startsoc >= 20 &&
          session.startsoc <= 80 &&
          session.endsoc >= 20 &&
          session.endsoc <= 80
        );

      case "lowsocchargingviolation":
        // Started charging at SoC < 15%
        return session.startsoc < 15;

      case "inactiveafterfullcharge":
        // Ends at >= 98% and no trips in next 12 hours (6 hours window)
        if (session.endsoc >= 98) {
          const sessionEndTime = session.endtime;
          const sixHoursLater = sessionEndTime + 12 * 60 * 60 * 1000; // 12 hours in milliseconds
          const tripsForVin = this.findTripsInWindow(
            tripIndex,
            session.vin,
            sessionEndTime,
            sixHoursLater
          );
          return tripsForVin.length === 0;
        }
        return false;

      case "peakhourschargesessions":
        // Charging during 5 PM - 10 PM IST (17:00 - 22:00)
        const startDate = new Date(session.starttime);
        const endDate = new Date(session.endtime);
        const startHourIST =
          (startDate.getUTCHours() +
            5 +
            Math.floor((startDate.getUTCMinutes() + 30) / 60)) %
          24;
        const endHourIST =
          (endDate.getUTCHours() +
            5 +
            Math.floor((endDate.getUTCMinutes() + 30) / 60)) %
          24;
        return (
          (endHourIST >= 17 && endHourIST < 22) ||
          (startHourIST >= 17 && startHourIST < 22) ||
          (startHourIST < 17 && endHourIST >= 22) ||
          (startHourIST >= 17 && endHourIST < 17)
        );

      case "idleconnection":
        // Connected > 1 hour but gained < 5% SoC
        return durationSecs > 3600 && (session.endsoc - session.startsoc) < 5;

      default:
        return false;
    }
  };

  // Updated processChargeDataForDate to use unified matchesCategory
  processChargeDataForDate = (sessions, tripIndex) => {
    let countLongPost100 = 0;
    let countIntermittent = 0;
    let lowsocSessions = 0;
    let inactiveafterfullcharge = 0;
    let peakhourschargesessions = 0;
    let idleconnection = 0;

    for (const session of sessions) {
      if (this.matchesCategory(session, "chargebehaviorviolation", tripIndex)) {
        countLongPost100++;
      }
      if (this.matchesCategory(session, "intermittentcharging", tripIndex)) {
        countIntermittent++;
      }
      if (this.matchesCategory(session, "lowsocchargingviolation", tripIndex)) {
        lowsocSessions++;
      }
      if (this.matchesCategory(session, "inactiveafterfullcharge", tripIndex)) {
        inactiveafterfullcharge++;
      }
      if (this.matchesCategory(session, "peakhourschargesessions", tripIndex)) {
        peakhourschargesessions++;
      }
      if (this.matchesCategory(session, "idleconnection", tripIndex)) {
        idleconnection++;
      }
    }

    return {
      countLongPost100,
      countIntermittent,
      lowsocSessions,
      inactiveafterfullcharge,
      peakhourschargesessions,
      idleconnection,
      totalSessions: sessions.length,
    };
  };

  GetFleetChargeInsightsOverviewLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive
  ) => {
    try {
      // Use common base data function
      const baseData = await this.getFleetChargeInsightsBaseData(
        accountid,
        fleetid,
        starttime,
        endtime,
        recursive
      );

      if (baseData.totalvehicles === 0) {
        return this.buildChargeNoDataOverview(starttime, endtime, 0);
      }

      const { chargeData, tripIndex, totalvehicles } = baseData;
      const totalchargesessions = chargeData.length;

      if (!chargeData || totalchargesessions === 0) {
        return this.buildChargeNoDataOverview(starttime, endtime, totalvehicles);
      }

      // ADD: Filter sessions to ensure they're within the time range (same as List function)
      const filteredChargeData = chargeData.filter((session) => {
        return session.starttime >= parseInt(starttime) && session.starttime < parseInt(endtime);
      });

      // Group sessions by IST date (using filtered data)
      const sessionsByDate = await this.groupSessionsByDate(filteredChargeData);

      const allDates = [];
      const dateEpochMap = {};
      let currentEpoch = parseInt(starttime);
      const endEpoch = parseInt(endtime);
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      while (currentEpoch <= endEpoch) {
        const dateKey = this.toISTDateString(currentEpoch);
        allDates.push(dateKey);
        const startepoch = currentEpoch;
        const endepoch = currentEpoch + (ONE_DAY_MS - 1000);

        dateEpochMap[dateKey] = { startepoch, endepoch };
        currentEpoch += ONE_DAY_MS;
      }

      // Prepare daily breakdowns for each category
      const categories = [
        "chargebehaviorviolation",
        "intermittentcharging",
        "lowsocchargingviolation",
        "inactiveafterfullcharge",
        "peakhourschargesessions",
        "idleconnection",
      ];
      const drilldowndata = {};
      categories.forEach((cat) => {
        drilldowndata[cat] = {
          category: cat,
          title: "",
          threshold: 0,
          unit: "sessions",
          dailydata: [],
        };
      });

      // Set titles, thresholds, units for each category
      drilldowndata.chargebehaviorviolation.title =
        "Charge Behavior Violation - Daily Breakdown";
      drilldowndata.intermittentcharging.title =
        "Charge Behavior Violation - Daily Breakdown";
      drilldowndata.lowsocchargingviolation.title =
        "Low SoC Charging Violation - Daily Breakdown";
      drilldowndata.inactiveafterfullcharge.title =
        "Inactive After Full Charge - Daily Breakdown";
      drilldowndata.peakhourschargesessions.title =
        "Peak Hours Charge Sessions - Daily Breakdown";
      drilldowndata.idleconnection.title = "Idle Connection - Daily Breakdown";

      const thresholds = {
        chargebehaviorviolation: 2,
        intermittentcharging: 2,
        lowsocchargingviolation: 2,
        inactiveafterfullcharge: 1,
        peakhourschargesessions: 2,
        idleconnection: 1,
      };

      const summaryLowSocThresholdPercent = 20;

      // Process all dates in parallel
      const dateProcessingPromises = allDates.map(async (date) => {
        const sessions = sessionsByDate[date] || [];
        const result = this.processChargeDataForDate(sessions, tripIndex);
        return { date, ...result };
      });

      const processedDates = await Promise.all(dateProcessingPromises);

      // Aggregate results
      let totalLongPost100 = 0;
      let totalIntermittent = 0;
      let totalLowSoc = 0;
      let totalInactiveAfterFull = 0;
      let totalPeakHour = 0;
      let totalIdleConn = 0;
      let totalLowSocSessions = 0;

      // Process results and build drilldown data
      for (const processed of processedDates) {
        const {
          date,
          countLongPost100,
          countIntermittent,
          lowsocSessions,
          inactiveafterfullcharge,
          peakhourschargesessions,
          idleconnection,
          totalSessions,
        } = processed;

        const { startepoch, endepoch } = dateEpochMap[date] || {
          startepoch: null,
          endepoch: null,
        };

        totalLongPost100 += countLongPost100;
        totalIntermittent += countIntermittent;
        totalLowSoc += lowsocSessions;
        totalLowSocSessions += totalSessions;
        totalInactiveAfterFull += inactiveafterfullcharge;
        totalPeakHour += peakhourschargesessions;
        totalIdleConn += idleconnection;

        // For daily breakdown - same structure as before
        drilldowndata.chargebehaviorviolation.dailydata.push({
          date,
          startepoch,
          endepoch,
          value: `${countLongPost100}`,
          rawvalue: countLongPost100,
          threshold: `${thresholds.chargebehaviorviolation} sessions`,
          status:
            countLongPost100 > thresholds.chargebehaviorviolation
              ? "above_threshold"
              : "within_threshold",
          sessions: totalSessions,
          details: `Long post-100%: ${countLongPost100}`,
        });
        // ... (similar for other categories - keep existing structure)
        drilldowndata.intermittentcharging.dailydata.push({
          date,
          startepoch,
          endepoch,
          value: `${countIntermittent}`,
          rawvalue: countIntermittent,
          threshold: `${thresholds.intermittentcharging} sessions`,
          status:
            countIntermittent > thresholds.intermittentcharging
              ? "above_threshold"
              : "within_threshold",
          sessions: totalSessions,
          details: `Intermittent charging: ${countIntermittent}`,
        });
        drilldowndata.lowsocchargingviolation.dailydata.push({
          date,
          startepoch,
          endepoch,
          value: `${lowsocSessions}`,
          rawvalue: lowsocSessions,
          threshold: `${thresholds.lowsocchargingviolation} sessions`,
          status:
            lowsocSessions > thresholds.lowsocchargingviolation
              ? "above_threshold"
              : "within_threshold",
          sessions: totalSessions,
          details: `Low SoC sessions: ${lowsocSessions}`,
        });
        drilldowndata.inactiveafterfullcharge.dailydata.push({
          date,
          startepoch,
          endepoch,
          value: `${inactiveafterfullcharge}`,
          rawvalue: inactiveafterfullcharge,
          threshold: `${thresholds.inactiveafterfullcharge} sessions`,
          status:
            inactiveafterfullcharge > thresholds.inactiveafterfullcharge
              ? "above_threshold"
              : "within_threshold",
          sessions: totalSessions,
          details: `Inactive after full charge: ${inactiveafterfullcharge}`,
        });
        drilldowndata.peakhourschargesessions.dailydata.push({
          date,
          startepoch,
          endepoch,
          value: `${peakhourschargesessions}`,
          rawvalue: peakhourschargesessions,
          threshold: `${thresholds.peakhourschargesessions} sessions`,
          status:
            peakhourschargesessions > thresholds.peakhourschargesessions
              ? "above_threshold"
              : "within_threshold",
          sessions: totalSessions,
          details: `Peak hour sessions: ${peakhourschargesessions}`,
        });
        drilldowndata.idleconnection.dailydata.push({
          date,
          startepoch,
          endepoch,
          value: `${idleconnection}`,
          rawvalue: idleconnection,
          threshold: `${thresholds.idleconnection} sessions`,
          status:
            idleconnection > thresholds.idleconnection
              ? "above_threshold"
              : "within_threshold",
          sessions: totalSessions,
          details: `Idle connection sessions: ${idleconnection}`,
        });
      }

      // Calculate summary percent for lowsoc
      const lowsocPercent =
        totalLowSocSessions > 0
          ? (totalLowSoc / totalLowSocSessions) * 100
          : 0;

      const totalDays = Math.max(
        1,
        Math.ceil((endtime - starttime) / 86400000)
      );

      // Build summary insights array
      const insights = [];

      if (totalLongPost100 > 0) {
        insights.push({
          displayname: "Charge Behavior Violation",
          type: "warning",
          category: "chargebehaviorviolation",
          title: "Charging after 100%",
          message: "Charging > 30min after full charge",
          details: `Detected ${totalLongPost100} sessions with >30min charging post 100% SoC.`,
          value: `${totalLongPost100} sessions`,
          rawvalue: totalLongPost100,
          threshold: `Ideal is ${
            thresholds.chargebehaviorviolation * totalDays
          } sessions`,
          status:
            totalLongPost100 > thresholds.chargebehaviorviolation * totalDays
              ? "above_threshold"
              : "within_threshold",
          priority: "high",
        });
      }
      if (totalIntermittent > 0) {
        insights.push({
          displayname: "Charge Behavior Violation",
          type: "warning",
          category: "intermittentcharging",
          title: "Intermittent Charging",
          message: "Too many partial charging sessions",
          details: `Detected ${totalIntermittent} intermittent charging sessions.`,
          value: `${totalIntermittent} sessions`,
          rawvalue: totalIntermittent,
          threshold: `Ideal is ${
            thresholds.chargebehaviorviolation * totalDays
          } sessions`,
          status:
            totalIntermittent > thresholds.chargebehaviorviolation * totalDays
              ? "above_threshold"
              : "within_threshold",
          priority: "high",
        });
      }
      if (lowsocPercent > summaryLowSocThresholdPercent) {
        insights.push({
          displayname: "Low SoC Charging",
          type: "warning",
          category: "lowsocchargingviolation",
          title: "Low SoC Charging",
          message: "Charging started at SoC < 15% too often",
          details: `Low SoC charging in ${totalLowSoc} out of ${totalLowSocSessions} sessions (${this.safeToFixed(
            lowsocPercent,
            1
          )}%).`,
          value: `${totalLowSoc} sessions`,
          rawvalue: totalLowSoc,
          threshold: `${summaryLowSocThresholdPercent}%`,
          status:
            lowsocPercent > summaryLowSocThresholdPercent
              ? "above_threshold"
              : "within_threshold",
          priority: "medium",
        });
      }
      if (totalInactiveAfterFull > 0) {
        insights.push({
          displayname: "Inactive After Full Charge",
          type: "info",
          category: "inactiveafterfullcharge",
          title: "Inactive After Full",
          message: "Long inactivity after 100% charge",
          details: `Detected ${totalInactiveAfterFull} sessions with inactivity after full charge.`,
          value: `${totalInactiveAfterFull} sessions`,
          rawvalue: totalInactiveAfterFull,
          threshold: `Ideal is ${
            thresholds.inactiveafterfullcharge * totalDays
          } sessions`,
          status:
            totalInactiveAfterFull >
            thresholds.inactiveafterfullcharge * totalDays
              ? "above_threshold"
              : "within_threshold",
          priority: "medium",
        });
      }
      if (totalPeakHour > 0) {
        insights.push({
          displayname: "Peak Hour Charging",
          type: "info",
          category: "peakhourschargesessions",
          title: "Peak Hour Charging",
          message: "Charging mostly during 6-10 PM",
          details: `Detected ${totalPeakHour} sessions during peak hours.`,
          value: `${totalPeakHour} sessions`,
          rawvalue: totalPeakHour,
          threshold: `Ideal is ${
            thresholds.peakhourschargesessions * totalDays
          } sessions`,
          status:
            totalPeakHour > thresholds.peakhourschargesessions * totalDays
              ? "above_threshold"
              : "within_threshold",
          priority: "low",
        });
      }
      if (totalIdleConn > 0) {
        insights.push({
          displayname: "Idle Connection",
          type: "info",
          category: "idleconnection",
          title: "Idle Connection",
          message: "Charger connected but low energy draw",
          details: `Detected ${totalIdleConn} idle connection sessions.`,
          value: `${totalIdleConn} sessions`,
          rawvalue: totalIdleConn,
          threshold: `Ideal is ${
            thresholds.idleconnection * totalDays
          } sessions`,
          status:
            totalIdleConn > thresholds.idleconnection * totalDays
              ? "above_threshold"
              : "within_threshold",
          priority: "low",
        });
      }

      return {
        insights,
        drilldowndata,
        totalchargesessions,
        totalvehicles,
        analysisperiod: {
          starttime: this.toISTDateString(parseInt(starttime)),
          endtime: this.toISTDateString(parseInt(endtime)),
        },
      };
    } catch (error) {
      this.logger.error("Error in GetFleetChargeInsightsOverviewLogic:", error);
      throw error;
    }
  };

  GetFleetChargeInsightsOverviewListLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    category,
    recursive
  ) => {
    try {
      // Use common base data function
      const baseData = await this.getFleetChargeInsightsBaseData(
        accountid,
        fleetid,
        starttime,
        endtime,
        recursive
      );

      if (baseData.totalvehicles === 0) {
        return this.buildDefaultDateStructure(starttime, endtime);
      }

      const { chargeData, tripIndex, vinregnoMap } = baseData;

      if (!chargeData || chargeData.length === 0) {
        return this.buildDefaultDateStructure(starttime, endtime);
      }

      // Filter sessions based on category using unified logic
      const filteredSessions = chargeData.filter((session) => {
        return this.matchesCategory(session, category, tripIndex);
      });

      // Build default date structure first
      const sessionsByDate = this.buildDefaultDateStructure(starttime, endtime);

      // Populate with filtered sessions
      for (const session of filteredSessions) {
        if (
          session.starttime < parseInt(starttime) ||
          session.starttime >= parseInt(endtime)
        ) {
          continue;
        }
        const dateKey = this.toISTDateString(session.starttime);

        const duration =
          session.chargingtime || session.endtime - session.starttime;
        const socgained = session.endsoc - session.startsoc;
        const status = this.calculateStatus(session, category, duration);

        const unitgained = (
          this.calculateUnitGained(session.startkwh, session.endkwh) || 0
        ).toFixed(2);

        sessionsByDate[dateKey].push({
          vin: session.vin,
          regno: vinregnoMap[session.vin] || session.vin,
          starttime: formatEpochToDateTime(session.starttime),
          endtime: formatEpochToDateTime(session.endtime),
          duration: formatEpochToDuration(duration),
          startsoc: `${session.startsoc}%`,
          endsoc: `${session.endsoc}%`,
          socgained: `${socgained}%`,
          unitgained: `${unitgained} kWh`,
          status: status,
        });
      }

      return sessionsByDate;
    } catch (error) {
      this.logger.error(
        "Error in GetFleetChargeInsightsOverviewListLogic:",
        error
      );
      throw error;
    }
  };

  // Remove the old matchesCategory - it's now unified above
  // Keep calculateStatus helper
  calculateStatus = (session, category, duration) => {
    const thresholds = {
      chargebehaviorviolation: 60 * 60 * 1000, // 1 hour in milliseconds
      intermittentcharging: 0,
      lowsocchargingviolation: 0,
      inactiveafterfullcharge: 0,
      peakhourschargesessions: 0,
      idleconnection: 0,
    };

    if (category === "chargebehaviorviolation") {
      return duration > thresholds.chargebehaviorviolation
        ? "above_threshold"
        : "within_threshold";
    }

    return "above_threshold";
  };

  // Helper method to build default date structure with empty arrays
  buildDefaultDateStructure = (starttime, endtime) => {
    const dateStructure = {};
    const startDate = new Date(parseInt(starttime));
    const endDate = new Date(parseInt(endtime));
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateKey = this.toISTDateString(currentDate.getTime());
      dateStructure[dateKey] = [];
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dateStructure;
  };

  buildChargeNoDataOverview(starttime, endtime, totalvehicles) {
    const categories = [
      "chargebehaviorviolation",
      "intermittentcharging",
      "lowsocchargingviolation",
      "inactiveafterfullcharge",
      "peakhourschargesessions",
      "idleconnection",
    ];
    const thresholds = {
      chargebehaviorviolation: 2,
      intermittentcharging: 2,
      lowsocchargingviolation: 2,
      inactiveafterfullcharge: 1,
      peakhourschargesessions: 2,
      idleconnection: 1,
    };
    const titles = {
      chargebehaviorviolation: "Charging after 100%",
      intermittentcharging: "Intermittent Charging",
      lowsocchargingviolation: "Low SoC Charging",
      inactiveafterfullcharge: "Inactive After Full",
      peakhourschargesessions: "Peak Hour Charging",
      idleconnection: "Idle Connection",
    };
    const displaynames = {
      chargebehaviorviolation: "Charge Behavior Violation",
      intermittentcharging: "Charge Behavior Violation",
      lowsocchargingviolation: "Low SoC Charging",
      inactiveafterfullcharge: "Inactive After Full Charge",
      peakhourschargesessions: "Peak Hour Charging",
      idleconnection: "Idle Connection",
    };
    const drilldownTitles = {
      chargebehaviorviolation: "Charge Behavior Violation - Daily Breakdown",
      intermittentcharging: "Charge Behavior Violation - Daily Breakdown",
      lowsocchargingviolation: "Low SoC Charging Violation - Daily Breakdown",
      inactiveafterfullcharge: "Inactive After Full Charge - Daily Breakdown",
      peakhourschargesessions: "Peak Hours Charge Sessions - Daily Breakdown",
      idleconnection: "Idle Connection - Daily Breakdown",
    };
    const totalDays = Math.max(1, Math.ceil((endtime - starttime) / 86400000));
  
    const insights = categories.map((cat) => ({
      displayname: displaynames[cat],
      type: "info",
      category: cat,
      title: titles[cat],
      message: `No data available for ${titles[cat]} analysis.`,
      details: "Insufficient data for analysis",
      value: "0 sessions",
      rawvalue: 0,
      threshold: `Ideal is ${thresholds[cat] * totalDays} sessions`,
      status: "no_data",
      priority:
        cat === "chargebehaviorviolation" || cat === "intermittentcharging"
          ? "high"
          : cat === "lowsocchargingviolation" || cat === "inactiveafterfullcharge"
          ? "medium"
          : "low",
    }));
  
    const drilldowndata = {};
    categories.forEach((cat) => {
      drilldowndata[cat] = {
        category: cat,
        title: drilldownTitles[cat],
        threshold: thresholds[cat],
        unit: "sessions",
        dailydata: [],
      };
    });
  
    return {
      insights,
      drilldowndata,
      totalchargesessions: 0,
      totalvehicles: totalvehicles || 0,
      analysisperiod: {
        start: this.toISTDateString(parseInt(starttime)),
        end: this.toISTDateString(parseInt(endtime)),
      },
    };
  }
}
