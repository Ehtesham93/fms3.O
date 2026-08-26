import { DateTime } from "luxon";
import { toFormattedString } from "../../../utils/epochconverter.js";

export default class FleetInsightsHdlrImpl {
  constructor(fleetInsightsSvcI, fmsAccountSvcI, logger) {
    this.fleetInsightsSvcI = fleetInsightsSvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.logger = logger;
  }

  GetAllFleetsLogic = async (accountid, fleetid, recursive) => {
    try {
      let rootFleetId;
      if (!fleetid) {
        rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
        if (!rootFleetId) {
          throw new Error("Root fleet not found for account");
        }
      } else {
        rootFleetId = fleetid;
      }

      let rootFleetHierarchy = await this.buildFleetHierarchy(
        accountid,
        rootFleetId,
        recursive
      );

      return rootFleetHierarchy;
    } catch (error) {
      this.logger.error("Error in GetAllFleets:", error);
      throw error;
    }
  };

  GetAccountOverviewLogic = async (accountid, fleetid, recursive) => {
    try {
      let rootFleetId;
      if (!fleetid) {
        rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
        if (!rootFleetId) throw new Error("Root fleet not found for account");
      } else {
        rootFleetId = fleetid;
      }

      const vehicles =
        (await this.fmsAccountSvcI.GetVehicles(
          accountid,
          rootFleetId,
          recursive
        )) || [];

      const childFleets = await this.fmsAccountSvcI.GetChildFleets(
        accountid,
        rootFleetId,
        recursive
      );

      const totalfleets = childFleets?.length || 0;
      const totalvehicles = vehicles.length;
      const totalmodels = new Set(vehicles.map((v) => v.modelcode)).size;

      const modeloverview = {};
      vehicles.forEach((v) => {
        const key = `${v.vehiclemodel} ${v.vehiclevariant}`;
        modeloverview[key] = (modeloverview[key] || 0) + 1;
      });

      const cityoverview = {};
      vehicles.forEach((v) => {
        const key = v.vehicle_city ?? null;
        if (key) {
          cityoverview[key] = (cityoverview[key] || 0) + 1;
        }
      });

      const monthlyDeliveries = {};
      vehicles.forEach((v) => {
        if (v.delivered_date) {
          const date = new Date(v.delivered_date);
          const key = `${date.getFullYear()}-${String(
            date.getMonth() + 1
          ).padStart(2, "0")}`;
          monthlyDeliveries[key] = (monthlyDeliveries[key] || 0) + 1;
        }
      });

      const fleetgrowth = {};
      let cumulativeTotal = 0;

      const sortedMonths = Object.keys(monthlyDeliveries).sort();

      sortedMonths.forEach((month) => {
        cumulativeTotal += monthlyDeliveries[month];
        fleetgrowth[month] = cumulativeTotal;
      });

      return {
        totalfleets,
        totalvehicles,
        totalmodels,
        modeloverview,
        cityoverview,
        fleetgrowth,
      };
    } catch (err) {
      this.logger.error("Error in GetAccountOverview:", err);
      throw err;
    }
  };

  GetFleetAgeLogic = async (accountid, fleetid, recursive) => {
    try {
      let rootFleetId;
      if (!fleetid) {
        rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
        if (!rootFleetId) throw new Error("Root fleet not found for account");
      } else {
        rootFleetId = fleetid;
      }
      if (!rootFleetId) {
        throw new Error("Root fleet not found for account");
      }

      const vehicles =
        (await this.fmsAccountSvcI.GetVehicles(
          accountid,
          rootFleetId,
          recursive
        )) || [];

      if (vehicles.length === 0) {
        return { fleetAge: {} };
      }

      const vinNumbers = vehicles.map((v) => v.vinno);

      const canDataMap = await this.fleetInsightsSvcI.GetLatestCanData(
        vinNumbers
      );

      const buckets = [
        { min: 0, max: 0, label: "0" },
        { min: 1, max: 50, label: "50" },
        { min: 51, max: 100, label: "100" },
        { min: 101, max: 150, label: "150" },
        { min: 151, max: 200, label: "200" },
        { min: 201, max: 250, label: "250" },
        { min: 251, max: 300, label: "300" },
        { min: 301, max: 350, label: "350" },
        { min: 351, max: 400, label: "400" },
        { min: 401, max: 450, label: "450" },
        { min: 451, max: 500, label: "500" },
        { min: 501, max: 600, label: "600" },
        { min: 601, max: 700, label: "700" },
        { min: 701, max: 800, label: "800" },
        { min: 801, max: 900, label: "900" },
        { min: 901, max: 1000, label: "1000" },
        { min: 1001, max: 1200, label: "1200" },
        { min: 1201, max: 1400, label: "1400" },
        { min: 1401, max: 1600, label: "1600" },
        { min: 1601, max: 1800, label: "1800" },
        { min: 1801, max: 2000, label: "2000" },
        { min: 2001, max: Infinity, label: "2000+" },
      ];

      const bucketCounts = {};
      buckets.forEach((bucket) => {
        bucketCounts[bucket.label] = 0;
      });

      vehicles.forEach((vehicle) => {
        const canData = canDataMap[vehicle.vinno];
        let cycleNum = 0;

        if (
          canData &&
          canData.bms_cyclenum !== undefined &&
          canData.bms_cyclenum !== null
        ) {
          cycleNum = parseInt(canData.bms_cyclenum) || 0;
        }

        const bucket = buckets.find(
          (b) => cycleNum >= b.min && cycleNum <= b.max
        );
        if (bucket) {
          bucketCounts[bucket.label]++;
        }
      });

      const fleetAge = {};
      Object.keys(bucketCounts).forEach((label) => {
        if (bucketCounts[label] > 0) {
          fleetAge[label] = bucketCounts[label];
        }
      });

      return { fleetAge };
    } catch (err) {
      this.logger.error("Error in GetFleetAge:", err);
      throw err;
    }
  };

  GetFleetAllAnalytics = async (
    accountid,
    starttime,
    endtime,
    fleetid,
    recursive,
    filter
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
      if (vehicles.length === 0) {
        return {
          totalchargingsessions: "0",
          totaldistancetravelled: "0 km",
          totaltrips: "0",
          totalenergyconsumed: "0 kWh",
          totalchargingdeviation: "0",
          distancetravelled: {},
          chargingsessions: {},
          trips: {},
          energyconsumed: {},
          chargingdeviation: {},
        };
      }
      const vinNumbers = vehicles.map((v) => v.vinno);

      return this.processAllAnalytics(
        accountid,
        vinNumbers,
        starttime,
        endtime,
        filter
      );
    } catch (err) {
      this.logger.error("Error in GetFleetAllAnalytics:", err);
      throw err;
    }
  };

  GetVehicleAllAnalytics = async (
    accountid,
    starttime,
    endtime,
    vinNumber,
    filter
  ) => {
    try {
      let vinNumbers;
      if (vinNumber) {
        vinNumbers = Array.isArray(vinNumber)
          ? vinNumber
          : vinNumber.includes(",")
          ? vinNumber.split(",")
          : [vinNumber];
      } else {
        throw new Error("Vin number is required");
      }

      if (vinNumbers.length === 0) {
        return {
          totalchargingsessions: "0",
          totaldistancetravelled: "0 km",
          totaltrips: "0",
          totalenergyconsumed: "0 kWh",
          totalchargingdeviation: "0",
          distancetravelled: {},
          chargingsessions: {},
          trips: {},
          energyconsumed: {},
          chargingdeviation: {},
        };
      }

      return this.processAllAnalytics(
        accountid,
        vinNumbers,
        starttime,
        endtime,
        filter
      );
    } catch (err) {
      this.logger.error("Error in GetVehicleAllAnalytics:", err);
      throw err;
    }
  };

  processAllAnalytics = async (
    accountid,
    vinNumbers,
    starttime,
    endtime,
    filter
  ) => {
    try {
      const [chargeData, tripData, deviationRows, regnoData] =
        await Promise.all([
          this.fleetInsightsSvcI.GetChargeInsightsByFleet(
            accountid,
            vinNumbers,
            starttime,
            endtime
          ),
          this.fleetInsightsSvcI.GetTripsByFleet(
            vinNumbers,
            starttime,
            endtime
          ),
          this.fleetInsightsSvcI.GetChargeDeviations(),
          this.fmsAccountSvcI.GetRegno(vinNumbers),
        ]);
      const vinToRegnoMap = {};
      regnoData.forEach(({ vinno, license_plate, modelinfo }) => {
        if (license_plate && license_plate.trim() !== "") {
          vinToRegnoMap[vinno] = { regno: license_plate, modelinfo };
        } else {
          vinToRegnoMap[vinno] = { regno: `${vinno}`, modelinfo };
        }
      });

      let totalchargingsessions = 0,
        totaldistancetravelled = 0,
        totalenergyconsumed = 0,
        totaltrips = 0,
        totalchargingdeviation = 0;
      let distancetravelled,
        chargingsessions,
        energyconsumed,
        trips,
        chargingdeviation;

      // Calculate other metrics (treesaved, co2emissionssaved, fuelcostsaved, etc.)

      if (filter === "all" || filter === "distancetravelled") {
        const res = this.calculateDistanceTravelled(
          tripData,
          vinToRegnoMap,
          starttime,
          endtime
        );
        totaldistancetravelled = res.totaldistancetravelled;
        distancetravelled = res.distancetravelled;
      }
      if (filter === "all" || filter === "chargingsessions") {
        const res = this.calculateChargingSessions(
          chargeData,
          vinToRegnoMap,
          starttime,
          endtime
        );
        totalchargingsessions = res.totalchargingsessions;
        chargingsessions = res.chargingsessions;
      }
      if (filter === "all" || filter === "energyconsumed") {
        const res = this.calculateEnergyConsumed(
          tripData,
          vinToRegnoMap,
          starttime,
          endtime
        );
        totalenergyconsumed = res.totalenergyconsumed;
        energyconsumed = res.energyconsumed;
      }
      if (filter === "all" || filter === "trips") {
        const res = this.calculateTrips(
          tripData,
          vinToRegnoMap,
          starttime,
          endtime
        );
        totaltrips = res.totaltrips;
        trips = res.trips;
      }
      if (filter === "all" || filter === "chargingdeviation") {
        const deviationMap = new Map(
          deviationRows.map((row) => [row.deviation_code, row.deviation_text])
        );

        const vinChargeMap = {};
        if (chargeData && chargeData.length > 0) {
          chargeData.forEach((charge) => {
            const vin = charge.vin;
            if (!vinChargeMap[vin]) vinChargeMap[vin] = [];
            vinChargeMap[vin].push(charge);
          });
        }
        const res = this.calculateChargingDeviation(
          vinChargeMap,
          deviationMap,
          vinToRegnoMap,
          starttime,
          endtime
        );
        totalchargingdeviation = res.totalchargingdeviation;
        chargingdeviation = res.chargingdeviation;
      }

      let result = {};
      if (!filter || filter === "") {
        const vinChargeMap = {};
        if (chargeData && chargeData.length > 0) {
          chargeData.forEach((charge) => {
            const vin = charge.vin;
            if (!vinChargeMap[vin]) vinChargeMap[vin] = [];
            vinChargeMap[vin].push(charge);
          });
        }
        ({
          totalchargingsessions,
          totaldistancetravelled,
          totalenergyconsumed,
          totaltrips,
        } = this.calculateTotalCounts(chargeData, tripData));
        totalchargingdeviation =
          this.calculateTotalChargingDeviation(vinChargeMap);
        result = {
          totalchargingsessions: toFormattedString(totalchargingsessions),
          totaldistancetravelled: `${toFormattedString(
            totaldistancetravelled
          )} km`,
          totalenergyconsumed: `${toFormattedString(totalenergyconsumed)} kWh`,
          totaltrips: toFormattedString(totaltrips),
          totalchargingdeviation: toFormattedString(totalchargingdeviation),
        };
      } else if (filter === "all") {
        result = {
          totalchargingsessions: toFormattedString(totalchargingsessions),
          totaldistancetravelled: `${toFormattedString(
            totaldistancetravelled
          )} km`,
          totalenergyconsumed: `${toFormattedString(totalenergyconsumed)} kWh`,
          totaltrips: toFormattedString(totaltrips),
          totalchargingdeviation: toFormattedString(totalchargingdeviation),
          distancetravelled,
          chargingsessions,
          trips,
          energyconsumed,
          chargingdeviation,
        };
      } else if (filter === "chargingsessions") {
        result = {
          totalchargingsessions: toFormattedString(totalchargingsessions),
          chargingsessions,
        };
      } else if (filter === "distancetravelled") {
        result = {
          totaldistancetravelled: `${toFormattedString(
            totaldistancetravelled
          )} km`,
          distancetravelled,
        };
      } else if (filter === "energyconsumed") {
        result = {
          totalenergyconsumed: `${toFormattedString(totalenergyconsumed)} kWh`,
          energyconsumed,
        };
      } else if (filter === "trips") {
        result = { totaltrips: toFormattedString(totaltrips), trips };
      } else if (filter === "chargingdeviation") {
        result = {
          totalchargingdeviation: toFormattedString(totalchargingdeviation),
          chargingdeviation,
        };
      }
      return result;
    } catch (err) {
      this.logger.error("Error in processAllAnalytics:", err);
      throw err;
    }
  };

  GetFleetAnalyticsLogic = async (accountid, starttime, endtime, fleetid) => {
    try {
      if (!fleetid) {
        const rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
        if (!rootFleetId) {
          throw new Error("Root fleet not found for account");
        }
        fleetid = rootFleetId;
      }

      const vehicles =
        (await this.fmsAccountSvcI.GetVehicles(accountid, fleetid, true)) || [];

      if (vehicles.length === 0) {
        const emptyDistance = {};
        const emptyChargingEvents = {};
        this.fillMissingDatesWithZeroValues(emptyDistance, starttime, endtime);
        this.fillMissingDatesWithZeroValues(
          emptyChargingEvents,
          starttime,
          endtime
        );

        return {
          totalchargingevent: 0,
          distancecovered: 0,
          energyconsumed: 0,
          distancetravelled: emptyDistance,
          chargingevents: emptyChargingEvents,
        };
      }

      const vinNumbers = vehicles.map((v) => v.vinno);

      const chargeData = await this.fleetInsightsSvcI.GetChargeInsightsByFleet(
        accountid,
        vinNumbers,
        starttime,
        endtime
      );

      const tripData = await this.fleetInsightsSvcI.GetTripsByFleet(
        vinNumbers,
        starttime,
        endtime
      );

      const totalchargingevent = chargeData ? chargeData.length : 0;

      let distancecovered = 0;
      let energyconsumed = 0;
      const dailyDistance = {};
      const dailyChargingEvents = {};

      if (chargeData && chargeData.length > 0) {
        chargeData.forEach((charge) => {
          if (charge.starttime) {
            const chargeDate = new Date(parseInt(charge.starttime));
            const dateKey = this.formatDateToIST(chargeDate);
            if (!dailyChargingEvents[dateKey]) {
              dailyChargingEvents[dateKey] = 0;
            }
            dailyChargingEvents[dateKey]++;
          }
        });
      }

      if (tripData && tripData.length > 0) {
        tripData.forEach((trip) => {
          const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
          distancecovered += tripDistance;

          const tripEnergy = (trip.startsoc || 0) - (trip.endsoc || 0);
          energyconsumed += tripEnergy;

          if (trip.starttime) {
            const tripDate = new Date(parseInt(trip.starttime));
            const dateKey = this.formatDateToIST(tripDate);

            if (!dailyDistance[dateKey]) {
              dailyDistance[dateKey] = 0;
            }
            dailyDistance[dateKey] += tripDistance;
          }
        });
      }

      distancecovered = Math.round(distancecovered * 100) / 100;
      energyconsumed = Math.round(energyconsumed * 100) / 100;

      Object.keys(dailyDistance).forEach((date) => {
        dailyDistance[date] = Math.round(dailyDistance[date] * 100) / 100;
      });

      this.fillMissingDatesWithZeroValues(dailyDistance, starttime, endtime);
      this.fillMissingDatesWithZeroValues(
        dailyChargingEvents,
        starttime,
        endtime
      );

      const sortedDailyDistance = {};
      Object.keys(dailyDistance)
        .sort((a, b) => {
          const dateA = new Date(a);
          const dateB = new Date(b);
          return dateA - dateB;
        })
        .forEach((key) => {
          sortedDailyDistance[key] = dailyDistance[key];
        });

      const sortedDailyChargingEvents = {};
      Object.keys(dailyChargingEvents)
        .sort((a, b) => {
          const dateA = new Date(a);
          const dateB = new Date(b);
          return dateA - dateB;
        })
        .forEach((key) => {
          sortedDailyChargingEvents[key] = dailyChargingEvents[key];
        });

      return {
        totalchargingevent,
        distancecovered,
        energyconsumed,
        distancetravelled: sortedDailyDistance,
        chargingevents: sortedDailyChargingEvents,
      };
    } catch (err) {
      this.logger.error("Error in GetFleetAnalytics:", err);
      throw err;
    }
  };

  GetFleetUtilizationLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive
  ) => {
    try {
      let rootFleetId = fleetid;
      if (!rootFleetId) {
        rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
        if (!rootFleetId) {
          throw new Error("Root fleet not found for account");
        }
      }

      // Get the entire fleet hierarchy first
      const fleetHierarchy = await this.buildFleetHierarchyForUtilization(
        accountid,
        rootFleetId,
        starttime,
        endtime
      );

      return fleetHierarchy;
    } catch (err) {
      this.logger.error("Error in GetFleetUtilization:", err);
      throw err;
    }
  };

  buildFleetHierarchyForUtilization = async (
    accountid,
    fleetid,
    starttime,
    endtime
  ) => {
    try {
      // Get all fleets in the hierarchy at once
      const allFleets = await this.getAllFleetsInHierarchy(accountid, fleetid);

      // Get all vehicles for all fleets in one query
      const allVehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        true
      );

      if (!allVehicles || allVehicles.length === 0) {
        return this.buildEmptyFleetHierarchy(allFleets);
      }

      // Get all VINs and fetch trip data once
      const allVinNumbers = [...new Set(allVehicles.map((v) => v.vinno))];
      const allTripData = await this.fleetInsightsSvcI.GetTripsByFleet(
        allVinNumbers,
        starttime,
        endtime
      );

      // Create a map of VIN to trip data for efficient lookup
      const tripDataByVin = {};
      if (allTripData && allTripData.length > 0) {
        allTripData.forEach((trip) => {
          if (!tripDataByVin[trip.vin]) {
            tripDataByVin[trip.vin] = [];
          }
          tripDataByVin[trip.vin].push(trip);
        });
      }

      // Build the hierarchy with pre-calculated data
      return await this.buildUtilizationHierarchyWithData(
        accountid,
        allFleets,
        allVehicles,
        tripDataByVin
      );
    } catch (error) {
      this.logger.error(
        `Error building utilization hierarchy for fleet ${fleetid}:`,
        error
      );
      throw error;
    }
  };

  getAllFleetsInHierarchy = async (accountid, fleetid) => {
    try {
      // Get all sub-fleets recursively in one query
      const subFleets = await this.fmsAccountSvcI.GetSubFleets(
        accountid,
        fleetid,
        true
      );

      // Add the root fleet
      const rootFleet = await this.fmsAccountSvcI.GetFleetInfo(
        accountid,
        fleetid
      );

      return [rootFleet, ...subFleets];
    } catch (error) {
      this.logger.error(`Error getting fleet hierarchy for ${fleetid}:`, error);
      throw error;
    }
  };

  buildUtilizationHierarchyWithData = async (
    accountid,
    allFleets,
    allVehicles,
    tripDataByVin
  ) => {
    // Create a map of fleet ID to vehicles for efficient lookup
    const vehiclesByFleet = {};
    allVehicles.forEach((vehicle) => {
      if (!vehiclesByFleet[vehicle.fleetid]) {
        vehiclesByFleet[vehicle.fleetid] = [];
      }
      vehiclesByFleet[vehicle.fleetid].push(vehicle);
    });

    // Create a map of fleet ID to fleet info
    const fleetInfoMap = {};
    allFleets.forEach((fleet) => {
      fleetInfoMap[fleet.fleetid] = fleet;
    });

    // Build the hierarchy recursively
    return this.buildFleetNode(
      accountid,
      allFleets[0].fleetid, // root fleet
      fleetInfoMap,
      vehiclesByFleet,
      tripDataByVin
    );
  };

  buildFleetNode = async (
    accountid,
    fleetid,
    fleetInfoMap,
    vehiclesByFleet,
    tripDataByVin
  ) => {
    const fleetInfo = fleetInfoMap[fleetid];
    if (!fleetInfo) return null;

    const vehicles = vehiclesByFleet[fleetid] || [];
    const utilization = this.calculateUtilizationForVehicles(
      vehicles,
      tripDataByVin
    );

    // Get direct children (not recursive, as we already have all fleets)
    const childFleets = Object.values(fleetInfoMap).filter(
      (fleet) => fleet.pfleetid === fleetid
    );

    const childNodes = await Promise.all(
      childFleets.map((childFleet) =>
        this.buildFleetNode(
          accountid,
          childFleet.fleetid,
          fleetInfoMap,
          vehiclesByFleet,
          tripDataByVin
        )
      )
    );

    return {
      fleetid: fleetInfo.fleetid,
      fleetname: fleetInfo.fleetname,
      totalvehiclecount: utilization.totalvehiclecount,
      totaldistancetravelled: utilization.totaldistancetravelled,
      fleetutilizationpercentage: utilization.fleetutilizationpercentage,
      range: utilization.range,
      childfleets: childNodes.filter((node) => node !== null),
    };
  };

  calculateUtilizationForVehicles = (vehicles, tripDataByVin) => {
    if (vehicles.length === 0) {
      return {
        totalvehiclecount: 0,
        totaldistancetravelled: 0,
        fleetutilizationpercentage: 0,
        range: 0,
      };
    }

    let totaldistancetravelled = 0;
    let totalSocConsumed = 0;
    const activeVehicles = new Set();

    vehicles.forEach((vehicle) => {
      const vehicleTrips = tripDataByVin[vehicle.vinno] || [];

      vehicleTrips.forEach((trip) => {
        const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
        totaldistancetravelled += tripDistance;

        const tripSocConsumed = (trip.startsoc || 0) - (trip.endsoc || 0);
        totalSocConsumed += tripSocConsumed;

        activeVehicles.add(trip.vin);
      });
    });

    const totalvehiclecount = vehicles.length;
    const activeVehicleCount = activeVehicles.size;
    const fleetutilizationpercentage =
      totalvehiclecount > 0
        ? Math.round((activeVehicleCount / totalvehiclecount) * 100 * 100) / 100
        : 0;

    const range =
      totalSocConsumed > 0
        ? Math.round((totaldistancetravelled / totalSocConsumed) * 100 * 100) /
          100
        : 0;

    totaldistancetravelled = Math.round(totaldistancetravelled * 100) / 100;

    return {
      totalvehiclecount,
      totaldistancetravelled,
      fleetutilizationpercentage,
      range,
    };
  };

  buildEmptyFleetHierarchy = (allFleets) => {
    const fleetInfoMap = {};
    allFleets.forEach((fleet) => {
      fleetInfoMap[fleet.fleetid] = fleet;
    });

    return this.buildEmptyFleetNode(allFleets[0].fleetid, fleetInfoMap);
  };

  buildEmptyFleetNode = (fleetid, fleetInfoMap) => {
    const fleetInfo = fleetInfoMap[fleetid];
    if (!fleetInfo) return null;

    const childFleets = Object.values(fleetInfoMap).filter(
      (fleet) => fleet.pfleetid === fleetid
    );

    const childNodes = childFleets
      .map((childFleet) =>
        this.buildEmptyFleetNode(childFleet.fleetid, fleetInfoMap)
      )
      .filter((node) => node !== null);

    return {
      fleetid: fleetInfo.fleetid,
      fleetname: fleetInfo.fleetname,
      totalvehiclecount: 0,
      totaldistancetravelled: 0,
      fleetutilizationpercentage: 0,
      range: 0,
      childfleets: childNodes,
    };
  };

  calculateFleetUtilization = async (
    accountid,
    fleetid,
    fleetname,
    starttime,
    endtime
  ) => {
    try {
      const vehicles =
        (await this.fmsAccountSvcI.GetVehicles(accountid, fleetid, true)) || [];

      if (vehicles.length === 0) {
        return {
          totalvehiclecount: 0,
          totaldistancetravelled: 0,
          fleetutilizationpercentage: 0,
          range: 0,
        };
      }

      const vinNumbers = vehicles.map((v) => v.vinno);
      const tripData = await this.fleetInsightsSvcI.GetTripsByFleet(
        vinNumbers,
        starttime,
        endtime
      );

      let totaldistancetravelled = 0;
      let totalSocConsumed = 0;
      const activeVehicles = new Set();

      if (tripData && tripData.length > 0) {
        tripData.forEach((trip) => {
          const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
          totaldistancetravelled += tripDistance;

          const tripSocConsumed = (trip.startsoc || 0) - (trip.endsoc || 0);
          totalSocConsumed += tripSocConsumed;

          activeVehicles.add(trip.vin);
        });
      }

      const totalvehiclecount = vehicles.length;
      const activeVehicleCount = activeVehicles.size;
      const fleetutilizationpercentage =
        totalvehiclecount > 0
          ? Math.round((activeVehicleCount / totalvehiclecount) * 100 * 100) /
            100
          : 0;

      const range =
        totalSocConsumed > 0
          ? Math.round(
              (totaldistancetravelled / totalSocConsumed) * 100 * 100
            ) / 100
          : 0;

      totaldistancetravelled = Math.round(totaldistancetravelled * 100) / 100;

      return {
        totalvehiclecount: totalvehiclecount,
        totaldistancetravelled: totaldistancetravelled,
        fleetutilizationpercentage: fleetutilizationpercentage,
        range: range,
      };
    } catch (err) {
      this.logger.error(
        `Error calculating utilization for fleet ${fleetid}:`,
        err
      );
      throw err;
    }
  };

  buildFleetHierarchy = async (accountid, fleetid, recursive) => {
    try {
      let fleetInfo = await this.fmsAccountSvcI.GetFleetInfo(
        accountid,
        fleetid
      );
      if (!fleetInfo) {
        return null;
      }

      let vehicleCount = 0;
      if (recursive) {
        let vehicles = await this.fmsAccountSvcI.GetVehicles(
          accountid,
          fleetid,
          true
        );
        vehicleCount = vehicles ? vehicles.length : 0;
      } else {
        let vehicles = await this.fmsAccountSvcI.GetVehicles(
          accountid,
          fleetid,
          false
        );
        vehicleCount = vehicles ? vehicles.length : 0;
      }

      let subFleets = await this.fmsAccountSvcI.GetSubFleets(
        accountid,
        fleetid,
        false
      );

      let fleetHierarchy = {
        fleetid: fleetInfo.fleetid,
        fleetname: fleetInfo.fleetname,
        noofvehicle: vehicleCount,
        childfleets: [],
      };

      if (subFleets && subFleets.length > 0) {
        for (let subFleet of subFleets) {
          let childHierarchy = await this.buildFleetHierarchy(
            accountid,
            subFleet.fleetid,
            recursive
          );
          if (childHierarchy) {
            fleetHierarchy.childfleets.push(childHierarchy);
          }
        }
      }

      return fleetHierarchy;
    } catch (error) {
      this.logger.error(
        `Error building hierarchy for fleet ${fleetid}:`,
        error
      );
      try {
        let fleetInfo = await this.fmsAccountSvcI.GetFleetInfo(
          accountid,
          fleetid
        );
        return {
          fleetid: fleetInfo.fleetid,
          fleetname: fleetInfo.fleetname,
          noofvehicle: 0,
          childfleets: [],
        };
      } catch (fallbackError) {
        this.logger.error(
          `Fallback error for fleet ${fleetid}:`,
          fallbackError
        );
        return null;
      }
    }
  };

  formatDateIST = (timestamp, type) => {
    if (type === "feild") {
      if (!timestamp || isNaN(Number(timestamp))) return null;
      const date = new Date(parseInt(timestamp));
      const day = date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
      });
      const weekday = date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
      });
      const month = date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        month: "short",
      });
      return `${weekday}, ${day} ${month}`;
    } else if (type === "metadata") {
      if (!timestamp || isNaN(Number(timestamp))) return [];
      const date = new Date(parseInt(timestamp));
      const day = date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
      });
      const weekday = date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
      });
      return [day, weekday];
    }
  };

  calculateChargingSessions = (
    chargeData,
    vinToRegnoMap,
    starttime,
    endtime
  ) => {
    const chargingsessions = {};
    this.fillMissingDates(chargingsessions, starttime, endtime);
    if (chargeData && chargeData.length > 0) {
      // 1. Group by dateKey
      const dateMap = {};
      chargeData.forEach((charge) => {
        if (charge.starttime) {
          const dateKey = this.formatDateIST(charge.starttime, "feild");
          if (!dateMap[dateKey]) dateMap[dateKey] = [];
          dateMap[dateKey].push(charge);
        }
      });

      // 2. Process each date group
      for (const dateKey in dateMap) {
        const chargesForDate = dateMap[dateKey];
        // Use the first charge to get metadata
        const dateKeyMetadata = this.formatDateIST(
          chargesForDate[0].starttime,
          "metadata"
        );
        chargingsessions[dateKey] = {
          total: 0,
          displaytotal: 0,
          day: dateKeyMetadata[0],
          week: dateKeyMetadata[1],
          timestamp: chargesForDate[0].starttime,
          vehicles: [],
        };
        const vinMap = {};

        chargesForDate.forEach((charge) => {
          const vin = charge.vin;
          chargingsessions[dateKey].total += 1;
          if (!vinMap[vin]) vinMap[vin] = 0;
          vinMap[vin] += 1;
        });

        chargingsessions[dateKey].displaytotal = toFormattedString(
          chargingsessions[dateKey].total
        );
        chargingsessions[dateKey].total = parseFloat(
          chargingsessions[dateKey].total.toFixed(2)
        );

        // Convert VIN map to vehicles array
        Object.keys(vinMap).forEach((vin) => {
          const regno = vinToRegnoMap[vin].regno;
          chargingsessions[dateKey].vehicles.push({
            vin: vin,
            regno: regno,
            total: toFormattedString(vinMap[vin]),
          });
        });
      }
    }
    let totalchargingsessions = chargeData ? chargeData.length : 0;
    return {
      totalchargingsessions,
      chargingsessions,
    };
  };

  calculateDistanceTravelled = (
    tripData,
    vinToRegnoMap,
    starttime,
    endtime
  ) => {
    let totaldistancetravelled = 0;
    const distancetravelled = {};
    this.fillMissingDates(distancetravelled, starttime, endtime);
    if (tripData && tripData.length > 0) {
      // Group trips by dateKey
      const dateMap = {};
      tripData.forEach((trip) => {
        if (trip.starttime) {
          const dateKey = this.formatDateIST(trip.starttime, "feild");
          if (!dateMap[dateKey]) dateMap[dateKey] = [];
          dateMap[dateKey].push(trip);
        }
      });

      // Process each date group
      for (const dateKey in dateMap) {
        const tripsForDate = dateMap[dateKey];
        const dateKeyMetadata = this.formatDateIST(
          tripsForDate[0].starttime,
          "metadata"
        );
        distancetravelled[dateKey] = {
          total: 0,
          displaytotal: 0,
          day: dateKeyMetadata[0],
          week: dateKeyMetadata[1],
          timestamp: tripsForDate[0].starttime,
          vehicles: [],
        };
        const vinMap = {};
        tripsForDate.forEach((trip) => {
          const vin = trip.vin;
          const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
          if (tripDistance > 0) {
            totaldistancetravelled += tripDistance;
            distancetravelled[dateKey].total += tripDistance;
            if (!vinMap[vin]) vinMap[vin] = 0;
            vinMap[vin] += tripDistance;
          }
        });
        distancetravelled[dateKey].displaytotal = `${toFormattedString(
          distancetravelled[dateKey].total
        )} km`;
        distancetravelled[dateKey].total = parseFloat(
          distancetravelled[dateKey].total.toFixed(2)
        );
        // Convert VIN map to vehicles array
        Object.keys(vinMap).forEach((vin) => {
          const regno = vinToRegnoMap[vin].regno;
          distancetravelled[dateKey].vehicles.push({
            vin: vin,
            regno: regno,
            total: `${toFormattedString(vinMap[vin])} km`,
          });
        });
      }
    }
    return {
      totaldistancetravelled,
      distancetravelled,
    };
  };

  calculateEnergyConsumed = (tripData, vinToRegnoMap, starttime, endtime) => {
    let totalenergyconsumed = 0;
    const energyconsumed = {};
    this.fillMissingDates(energyconsumed, starttime, endtime);
    if (tripData && tripData.length > 0) {
      // Group trips by dateKey
      const dateMap = {};
      tripData.forEach((trip) => {
        if (trip.starttime) {
          const dateKey = this.formatDateIST(trip.starttime, "feild"); // TODO: is this correct?
          if (!dateMap[dateKey]) dateMap[dateKey] = [];
          dateMap[dateKey].push(trip);
        }
      });

      // Process each date group
      for (const dateKey in dateMap) {
        const tripsForDate = dateMap[dateKey];
        const dateKeyMetadata = this.formatDateIST(
          tripsForDate[0].starttime,
          "metadata"
        );
        energyconsumed[dateKey].total = 0;
        energyconsumed[dateKey].day = dateKeyMetadata[0];
        energyconsumed[dateKey].week = dateKeyMetadata[1];
        energyconsumed[dateKey].timestamp = tripsForDate[0].starttime;
        energyconsumed[dateKey].vehicles = [];
        const vinMap = {};
        tripsForDate.forEach((trip) => {
          const vin = trip.vin;
          const distance = (trip.endodo || 0) - (trip.startodo || 0);
          if (distance > 0) {
            let startkwh =
              trip.startdata && typeof trip.startdata.kwh === "number"
                ? trip.startdata.kwh
                : null;
            let endkwh =
              trip.enddata && typeof trip.enddata.kwh === "number"
                ? trip.enddata.kwh
                : null;
            let tripEnergy = 0;
            if (startkwh !== null && endkwh !== null) {
              tripEnergy = Math.abs(startkwh - endkwh);
            }
            totalenergyconsumed += tripEnergy;
            energyconsumed[dateKey].total += tripEnergy;
            if (!vinMap[vin]) vinMap[vin] = 0;
            vinMap[vin] += tripEnergy;
          }
        });

        energyconsumed[dateKey].displaytotal = `${toFormattedString(
          energyconsumed[dateKey].total
        )} kWh`;
        energyconsumed[dateKey].total = parseFloat(
          energyconsumed[dateKey].total.toFixed(2)
        );

        // Convert VIN map to vehicles array
        Object.keys(vinMap).forEach((vin) => {
          const regno = vinToRegnoMap[vin].regno;
          energyconsumed[dateKey].vehicles.push({
            vin: vin,
            regno: regno,
            total: `${toFormattedString(vinMap[vin])} kWh`,
          });
        });
      }
    }
    totalenergyconsumed = Math.round(totalenergyconsumed * 100) / 100;
    return {
      totalenergyconsumed,
      energyconsumed,
    };
  };

  calculateTrips = (tripData, vinToRegnoMap, starttime, endtime) => {
    let totaltrips = 0;
    const trips = {};
    this.fillMissingDates(trips, starttime, endtime);
    if (tripData && tripData.length > 0) {
      // Group trips by dateKey
      const dateMap = {};
      tripData.forEach((trip) => {
        if (trip.starttime) {
          const dateKey = this.formatDateIST(trip.starttime, "feild");
          if (!dateMap[dateKey]) dateMap[dateKey] = [];
          dateMap[dateKey].push(trip);
        }
      });

      // Process each date group
      for (const dateKey in dateMap) {
        const tripsForDate = dateMap[dateKey];
        const dateKeyMetadata = this.formatDateIST(
          tripsForDate[0].starttime,
          "metadata"
        );
        trips[dateKey].total = 0;
        trips[dateKey].day = dateKeyMetadata[0];
        trips[dateKey].week = dateKeyMetadata[1];
        trips[dateKey].timestamp = tripsForDate[0].starttime;
        trips[dateKey].vehicles = [];
        const vinMap = {};
        tripsForDate.forEach((trip) => {
          const vin = trip.vin;
          trips[dateKey].total += 1;
          if (!vinMap[vin]) vinMap[vin] = 0;
          vinMap[vin] += 1;
        });

        trips[dateKey].displaytotal = toFormattedString(trips[dateKey].total);
        trips[dateKey].total = parseFloat(trips[dateKey].total.toFixed(2));

        // Convert VIN map to vehicles array
        Object.keys(vinMap).forEach((vin) => {
          const regno = vinToRegnoMap[vin].regno;
          trips[dateKey].vehicles.push({
            vin: vin,
            regno: regno,
            total: toFormattedString(vinMap[vin]),
          });
        });
      }
      totaltrips = tripData.length;
    }
    return {
      totaltrips,
      trips,
    };
  };

  calculateChargingDeviation = (
    vinChargeMap,
    deviationMap,
    vinToRegnoMap,
    starttime,
    endtime
  ) => {
    let totalchargingdeviation = 0;
    const chargingdeviation = {};
    this.fillMissingDates(chargingdeviation, starttime, endtime);
    if (vinChargeMap && Object.keys(vinChargeMap).length > 0) {
      for (const vin in vinChargeMap) {
        const regno = vinToRegnoMap[vin].regno;
        const charges = vinChargeMap[vin].sort(
          (a, b) => a.starttime - b.starttime
        );

        const dateMap = {};
        charges.forEach((charge) => {
          const dateKey = this.formatDateIST(charge.starttime, "feild");
          if (!dateMap[dateKey]) dateMap[dateKey] = [];
          dateMap[dateKey].push(charge);
        });

        for (const date in dateMap) {
          // Add day/week metadata for this date
          const dateKeyMetadata = this.formatDateIST(
            dateMap[date][0].starttime,
            "metadata"
          );
          if (!chargingdeviation[date]) {
            chargingdeviation[date] = {
              total: 0,
              displaytotal: 0,
              day: dateKeyMetadata[0],
              week: dateKeyMetadata[1],
              timestamp: dateMap[date][0].starttime,
              vehicles: [],
            };
          }

          let overchargeCount = 0;
          dateMap[date].forEach((charge) => {
            if (charge.endsoc >= 100 && charge.enddata) {
              const plugStatus = charge.enddata.bms_charger_plug_in_sts;
              const duration =
                (charge.endtime - charge.starttime) / (1000 * 60 * 60); // in hours
              if ((plugStatus === 1 || plugStatus === 2) && duration > 1) {
                overchargeCount++;
              }
            }
          });
          if (overchargeCount > 0) {
            // Find existing vehicle entry or create new one
            let vehicleEntry = chargingdeviation[date].vehicles.find(
              (v) => v.vin === vin
            );
            if (!vehicleEntry) {
              vehicleEntry = { vin: vin, regno: regno, deviations: [] };
              chargingdeviation[date].vehicles.push(vehicleEntry);
            }

            vehicleEntry.deviations.push({
              deviationcode: "OVERCHARGED_1",
              deviationtext: deviationMap.get("OVERCHARGED_1"),
              deviationcodecount: overchargeCount,
            });
            chargingdeviation[date].total =
              (chargingdeviation[date].total || 0) + overchargeCount;
            totalchargingdeviation += overchargeCount;
          }
        }

        for (let i = 3; i < charges.length; i += 4) {
          let found100 = false;
          for (let j = i - 3; j <= i; j++) {
            if (charges[j].endsoc >= 100) {
              found100 = true;
              break;
            }
          }
          const date = this.formatDateIST(charges[i].starttime, "feild");
          const dateKeyMetadata = this.formatDateIST(
            charges[i].starttime,
            "metadata"
          );
          if (!found100) {
            if (!chargingdeviation[date]) {
              chargingdeviation[date] = {
                total: 0,
                displaytotal: 0,
                day: dateKeyMetadata[0],
                week: dateKeyMetadata[1],
                timestamp: charges[i].starttime,
                vehicles: [],
              };
            }
            let vehicleEntry = chargingdeviation[date].vehicles.find(
              (v) => v.vin === vin
            );
            if (!vehicleEntry) {
              vehicleEntry = { vin: vin, regno: regno, deviations: [] };
              chargingdeviation[date].vehicles.push(vehicleEntry);
            }

            vehicleEntry.deviations.push({
              deviationcode: "INCOMPLETECHARGED_1",
              deviationtext: deviationMap.get("INCOMPLETECHARGED_1"),
              deviationcodecount: 1,
            });
            chargingdeviation[date].total =
              (chargingdeviation[date].total || 0) + 1;
            totalchargingdeviation += 1;
          }
        }

        let fastchargeStreak = 0;
        for (let i = 0; i < charges.length; i++) {
          if (charges[i].isfastcharging) {
            fastchargeStreak++;
            if (fastchargeStreak > 1) {
              const date = this.formatDateIST(charges[i].starttime, "feild");
              const dateKeyMetadata = this.formatDateIST(
                charges[i].starttime,
                "metadata"
              );
              if (!chargingdeviation[date]) {
                chargingdeviation[date] = {
                  total: 0,
                  displaytotal: 0,
                  day: dateKeyMetadata[0],
                  week: dateKeyMetadata[1],
                  timestamp: charges[i].starttime,
                  vehicles: [],
                };
              }
              let vehicleEntry = chargingdeviation[date].vehicles.find(
                (v) => v.vin === vin
              );
              if (!vehicleEntry) {
                vehicleEntry = { vin: vin, regno: regno, deviations: [] };
                chargingdeviation[date].vehicles.push(vehicleEntry);
              }

              vehicleEntry.deviations.push({
                deviationcode: "CONST_FASTCHARGE_1",
                deviationtext: deviationMap.get("CONST_FASTCHARGE_1"),
                deviationcodecount: 1,
              });
              chargingdeviation[date].total =
                (chargingdeviation[date].total || 0) + 1;
              totalchargingdeviation += 1;
            }
          } else {
            fastchargeStreak = 0;
          }
        }

        const has8hr = charges.some(
          (charge) => charge.endtime - charge.starttime >= 8 * 60 * 60 * 1000
        );
        if (!has8hr && charges.length > 0) {
          const lastCharge = charges[charges.length - 1];
          const date = this.formatDateIST(lastCharge.starttime, "feild");
          const dateKeyMetadata = this.formatDateIST(
            lastCharge.starttime,
            "metadata"
          );
          if (!chargingdeviation[date]) {
            chargingdeviation[date] = {
              total: 0,
              displaytotal: 0,
              day: dateKeyMetadata[0],
              week: dateKeyMetadata[1],
              timestamp: lastCharge.starttime,
              vehicles: [],
            };
          }
          let vehicleEntry = chargingdeviation[date].vehicles.find(
            (v) => v.vin === vin
          );
          if (!vehicleEntry) {
            vehicleEntry = { vin: vin, regno: regno, deviations: [] };
            chargingdeviation[date].vehicles.push(vehicleEntry);
          }

          vehicleEntry.deviations.push({
            deviationcode: "WEEKLY_DEVIATION_1",
            deviationtext: deviationMap.get("WEEKLY_DEVIATION_1"),
            deviationcodecount: 1,
          });
          chargingdeviation[date].total =
            (chargingdeviation[date].total || 0) + 1;
          totalchargingdeviation += 1;
        }
      }
    }
    for (const date in chargingdeviation) {
      chargingdeviation[date].displaytotal = toFormattedString(
        chargingdeviation[date].total
      );
      chargingdeviation[date].total = parseFloat(
        chargingdeviation[date].total.toFixed(2)
      );
    }
    return { totalchargingdeviation, chargingdeviation };
  };

  GetFleetVehicleEcoContributionLogic = async (
    accountid,
    fleetid,
    vehiclematric,
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
      if (vehicles.length === 0) {
        return {
          cumulativecontribution: {
            fuelcostsaved: "₹0",
            treesaved: "0",
            co2emissionssaved: "0 t",
          },
        };
      }

      const vinNumbers = vehicles.map((v) => v.vinno);

      return this.processEcoContribution(vinNumbers, vehiclematric);
    } catch (error) {
      throw new Error(error);
    }
  };

  GetVehicleEcoContributionLogic = async (
    accountid,
    vinnumbers,
    vehiclematric
  ) => {
    try {
      if (!accountid || !vinnumbers || vinnumbers.length === 0) {
        return {
          treesaved: "0",
          co2emissionssaved: "0 t",
          fuelcostsaved: "₹0",
        };
      }

      return this.processEcoContribution(vinnumbers, vehiclematric);
    } catch (error) {
      throw new Error(error);
    }
  };

  processEcoContribution = async (vinnumbers, vehiclematric) => {
    const [regnoData, canData] = await Promise.all([
      this.fmsAccountSvcI.GetRegno(vinnumbers),
      this.fmsAccountSvcI.getLatestCanDataForVins(vinnumbers),
    ]);

    const vinToRegnoMap = {};
    regnoData.forEach(({ vinno, license_plate, modelinfo }) => {
      if (license_plate && license_plate.trim() !== "") {
        vinToRegnoMap[vinno] = { license_plate, modelinfo };
      } else {
        vinToRegnoMap[vinno] = { license_plate: `${vinno}`, modelinfo };
      }
    });
    if (vehiclematric) {
      let fuelcostsaved = 0,
        treesaved = 0,
        co2emissionssaved = 0;
      let vehiclecontribution = [];
      if (
        canData &&
        typeof canData === "object" &&
        Object.keys(canData).length > 0
      ) {
        Object.keys(canData).forEach((vin) => {
          const data = canData[vin];
          let canFuelCostSaved = 0;
          let canTreesSaved = 0;
          let canCO2EmissionsSaved = 0;
          let electricco2emissionfactor = 850; // Default value for electric vehicles
          let milageoficevehicle = 35; // Default value for ICE vehicles
          let canDistance = 0;

          if (data.odometer && data.odometer > 0) {
            canDistance = data.odometer;
          }
          // Check if vinToRegnoMap has the VIN and brochurespecs
          if (
            vinToRegnoMap[vin] &&
            vinToRegnoMap[vin].modelinfo &&
            vinToRegnoMap[vin].modelinfo.brochurespecs
          ) {
            const canmodelinfo = vinToRegnoMap[vin].modelinfo.brochurespecs;
            const noofcycles = canDistance / parseInt(canmodelinfo.range);
            const batterneeded =
              noofcycles * parseInt(canmodelinfo.battery_capacity);
            const iceco2emission =
              canDistance * parseInt(canmodelinfo.co2_emission_factor);
            const electricco2emission =
              batterneeded * electricco2emissionfactor;
            canCO2EmissionsSaved =
              (iceco2emission - electricco2emission) / 1000000;
            canTreesSaved = (canCO2EmissionsSaved * 1000) / 21.77;
            canFuelCostSaved =
              (canDistance / milageoficevehicle) *
              parseInt(canmodelinfo.fuel_price_factor);
            vehiclecontribution.push({
              vin,
              fuelsaved: `₹${this.rupeeToFormattedString(canFuelCostSaved)}`,
              treessaved: Math.round(canTreesSaved).toString(),
              co2saved: `${toFormattedString(canCO2EmissionsSaved)} t`,
            });
            fuelcostsaved += canFuelCostSaved;
            treesaved += canTreesSaved;
            co2emissionssaved += canCO2EmissionsSaved;
          }
        });
      }

      return {
        cumulativecontribution: {
          fuelcostsaved: `₹${this.rupeeToFormattedString(fuelcostsaved)}`,
          treesaved: Math.round(treesaved).toString(),
          co2emissionssaved: `${toFormattedString(co2emissionssaved)} t`,
        },
        vehiclecontribution,
      };
    } else {
      let fuelcostsaved = 0,
        treesaved = 0,
        co2emissionssaved = 0;

      if (
        canData &&
        typeof canData === "object" &&
        Object.keys(canData).length > 0
      ) {
        Object.keys(canData).forEach((vin) => {
          const data = canData[vin];
          let canFuelCostSaved = 0;
          let canTreesSaved = 0;
          let canCO2EmissionsSaved = 0;
          let electricco2emissionfactor = 850; // Default value for electric vehicles
          let milageoficevehicle = 35; // Default value for ICE vehicles
          let canDistance = 0;

          if (data.odometer && data.odometer > 0) {
            canDistance = data.odometer;
          }
          // Check if vinToRegnoMap has the VIN and brochurespecs
          if (
            vinToRegnoMap[vin] &&
            vinToRegnoMap[vin].modelinfo &&
            vinToRegnoMap[vin].modelinfo.brochurespecs
          ) {
            const canmodelinfo = vinToRegnoMap[vin].modelinfo.brochurespecs;
            const noofcycles = canDistance / parseInt(canmodelinfo.range);
            const batterneeded =
              noofcycles * parseInt(canmodelinfo.battery_capacity);
            const iceco2emission =
              canDistance * parseInt(canmodelinfo.co2_emission_factor);
            const electricco2emission =
              batterneeded * electricco2emissionfactor;
            canCO2EmissionsSaved =
              (iceco2emission - electricco2emission) / 1000000;
            canTreesSaved = (canCO2EmissionsSaved * 1000) / 21.77;
            canFuelCostSaved =
              (canDistance / milageoficevehicle) *
              parseInt(canmodelinfo.fuel_price_factor);

            fuelcostsaved += canFuelCostSaved;
            treesaved += canTreesSaved;
            co2emissionssaved += canCO2EmissionsSaved;
          }
        });
      }

      return {
        cumulativecontribution: {
          fuelcostsaved: `₹${this.rupeeToFormattedString(fuelcostsaved)}`,
          treesaved: Math.round(treesaved).toString(),
          co2emissionssaved: `${toFormattedString(co2emissionssaved)} t`,
        },
      };
    }
  };

  calculateTotalCounts = (chargeData, tripData) => {
    let totalchargingsessions = 0,
      totaldistancetravelled = 0,
      totalenergyconsumed = 0,
      totaltrips = 0;
    if (chargeData && chargeData.length > 0) {
      totalchargingsessions = chargeData.length;
    }
    if (tripData && tripData.length > 0) {
      totaltrips = tripData.length;
      tripData.forEach((trip) => {
        const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
        if (tripDistance > 0) totaldistancetravelled += tripDistance;
        let startkwh =
          trip.startdata && typeof trip.startdata.kwh === "number"
            ? trip.startdata.kwh
            : null;
        let endkwh =
          trip.enddata && typeof trip.enddata.kwh === "number"
            ? trip.enddata.kwh
            : null;
        if (startkwh !== null && endkwh !== null)
          totalenergyconsumed += Math.abs(startkwh - endkwh);
      });
    }
    totaldistancetravelled = Math.round(totaldistancetravelled * 100) / 100;
    totalenergyconsumed = Math.round(totalenergyconsumed * 100) / 100;
    return {
      totalchargingsessions,
      totaldistancetravelled,
      totalenergyconsumed,
      totaltrips,
    };
  };

  calculateTotalChargingDeviation = (vinChargeMap) => {
    let totalchargingdeviation = 0;
    if (vinChargeMap && Object.keys(vinChargeMap).length > 0) {
      for (const vin in vinChargeMap) {
        const charges = vinChargeMap[vin].sort(
          (a, b) => a.starttime - b.starttime
        );

        // Overcharge deviation
        const dateMap = {};
        charges.forEach((charge) => {
          const dateKey = this.formatDateIST(charge.starttime, "feild");
          if (!dateMap[dateKey]) dateMap[dateKey] = [];
          dateMap[dateKey].push(charge);
        });
        for (const date in dateMap) {
          let overchargeCount = 0;
          dateMap[date].forEach((charge) => {
            if (charge.endsoc >= 100 && charge.enddata) {
              const plugStatus = charge.enddata.bms_charger_plug_in_sts;
              const duration =
                (charge.endtime - charge.starttime) / (1000 * 60 * 60); // in hours
              if ((plugStatus === 1 || plugStatus === 2) && duration > 1) {
                overchargeCount++;
              }
            }
          });
          if (overchargeCount > 0) {
            totalchargingdeviation += overchargeCount;
          }
        }

        // Incomplete charge deviation
        for (let i = 3; i < charges.length; i += 4) {
          let found100 = false;
          for (let j = i - 3; j <= i; j++) {
            if (charges[j].endsoc >= 100) {
              found100 = true;
              break;
            }
          }
          if (!found100) {
            totalchargingdeviation += 1;
          }
        }

        // Fast charge deviation
        let fastchargeStreak = 0;
        for (let i = 0; i < charges.length; i++) {
          if (charges[i].isfastcharging) {
            fastchargeStreak++;
            if (fastchargeStreak > 1) {
              totalchargingdeviation += 1;
            }
          } else {
            fastchargeStreak = 0;
          }
        }

        // Weekly deviation
        const has8hr = charges.some(
          (charge) => charge.endtime - charge.starttime >= 8 * 60 * 60 * 1000
        );
        if (!has8hr && charges.length > 0) {
          totalchargingdeviation += 1;
        }
      }
    }
    return totalchargingdeviation;
  };

  fillMissingDates = (
    resultObj,
    starttime,
    endtime,
    type = "feild",
    metaType = "metadata"
  ) => {
    const start = parseInt(starttime);
    const end = parseInt(endtime);

    const oneDay = 24 * 60 * 60 * 1000;
    for (let ts = start; ts <= end; ts += oneDay) {
      // Use the same formatDateIST method that's used for actual data
      const dateKey = this.formatDateIST(ts, "feild");
      if (!resultObj[dateKey]) {
        const meta = this.formatDateIST(ts, metaType);
        resultObj[dateKey] = {
          total: 0,
          displaytotal: "0",
          day: meta[0],
          week: meta[1],
          timestamp: ts,
          vehicles: [],
        };
      }
    }
  };

  fillMissingDatesWithZeroValues = (resultObj, starttime, endtime) => {
    const start = parseInt(starttime);
    const end = parseInt(endtime);

    const oneDay = 24 * 60 * 60 * 1000;
    for (let ts = start; ts <= end; ts += oneDay) {
      const date = new Date(ts);
      const dateKey = this.formatDateToIST(date);
      if (!resultObj[dateKey]) {
        resultObj[dateKey] = 0;
      }
    }
  };

  rupeeToFormattedString = (value) => {
    const absValue = Math.abs(value);
    const sign = value < 0 ? "-" : "";

    const trimmedTo2Decimals = (num) => {
      return parseFloat(num.toFixed(1)).toString();
    };

    if (absValue >= 1_00_00_00_000) {
      // 1,00,00,00,000 = 100 Cr
      return `${sign}${trimmedTo2Decimals(value / 1_00_00_000)}Cr`;
    } else if (absValue >= 1_00_000) {
      // 1,00,000 = 1 Lakh
      return `${sign}${trimmedTo2Decimals(value / 1_00_000)}L`;
    } else if (absValue >= 1_000) {
      return `${sign}${trimmedTo2Decimals(value / 1_000)}K`;
    } else {
      return trimmedTo2Decimals(value);
    }
  };

  formatDateToIST = (date) => {
    return DateTime.fromJSDate(date, { zone: "utc" })
      .setZone("Asia/Kolkata")
      .toFormat("dd LLL yyyy");
  };
}
