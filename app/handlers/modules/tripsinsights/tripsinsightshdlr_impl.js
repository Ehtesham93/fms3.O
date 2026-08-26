import { DateTime } from "luxon";
import {
  formatEpochToDuration,
  formatEpochToDateTime,
  toFormattedString,
} from "../../../utils/epochconverter.js";
import { DRIVING_MODES, DRIVING_MODE_TYPE } from "../../../utils/constant.js";

export default class TripsinsighthdlrImpl {
  constructor(tripsinsightssvcI, fmsAccountSvcI, logger) {
    this.tripsinsightssvcI = tripsinsightssvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.logger = logger;
  }

  GetVehicleTripReportLogic = async (vinno, starttime, endtime) => {
    try {
      let vinNumbers;
      if (vinno) {
        vinNumbers = Array.isArray(vinno)
          ? vinno
          : vinno.includes(",")
          ? vinno.split(",")
          : [vinno];
      } else {
        throw new Error("VIN NO is required");
      }

      if (vinNumbers.length === 0) {
        return {
          totaltrips: "0",
          totaldistancetravelled: "0 km",
          totalenergyconsumed: "0 kWh",
          vehicles: {},
        };
      }

      const result = await this.ProcessTripData(vinNumbers, starttime, endtime);
      return result;
    } catch (error) {
      this.logger.error("Error in GetTripReportLogic:", error);
      throw error;
    }
  };

  GetFleetTripReportLogic = async (
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
      let vinNumbers;
      const vehicles =
        (await this.fmsAccountSvcI.GetVehicles(
          accountid,
          fleetid,
          recursive
        )) || [];
      vinNumbers = vehicles.map((v) => v.vinno);

      if (vinNumbers.length === 0) {
        return {
          totaltrips: "0",
          totaldistancetravelled: "0 km",
          totalenergyconsumed: "0 kWh",
          vehicles: {},
        };
      }
      const result = await this.ProcessTripData(vinNumbers, starttime, endtime);
      return result;
    } catch (error) {
      this.logger.error("Error in GetTripReportLogic:", error);
      throw error;
    }
  };

  ProcessTripData = async (vinNumbers, starttime, endtime) => {
    try {
      const [tripData, regnodata] = await Promise.all([
        this.tripsinsightssvcI.GetTripsByFleet(vinNumbers, starttime, endtime),
        this.fmsAccountSvcI.GetRegno(vinNumbers),
      ]);

      if (!tripData || tripData.length === 0) {
        return {
          totaltrips: "0",
          totaldistancetravelled: "0 km",
          totalenergyconsumed: "0 kWh",
          vehicles: {},
        };
      }

      const vinToRegnoMap = {};
      regnodata.forEach(({ vinno, license_plate, modelfamilycode }) => {
        if (license_plate && license_plate.trim() !== "") {
          vinToRegnoMap[vinno] = {license_plate, modelfamilycode};
        } else {
          vinToRegnoMap[vinno] = {license_plate: `${vinno}`, modelfamilycode: modelfamilycode};
        }
      });

      // --- Batch processing on fetched data ---
      const BATCH_SIZE = 500;
      const batches = [];
      for (let i = 0; i < tripData.length; i += BATCH_SIZE) {
        batches.push(tripData.slice(i, i + BATCH_SIZE));
      }

      const safeCoord = (val) =>
        typeof val === "number" && !isNaN(val)
          ? parseFloat(val.toFixed(6))
          : null;

      // Process each batch concurrently
      const batchResults = await Promise.all(
        batches.map(async (batch) => {
          let batchVehicles = {};
          let batchTotalTrips = 0;
          let batchTotalDistance = 0;
          let batchTotalEnergy = 0;

          batch.forEach((trip) => {
            const vin = trip.vin;
            if (!batchVehicles[vin]) {
              batchVehicles[vin] = { tripcount: 0, trips: [] };
            }

            batchVehicles[vin].tripcount += 1;
            const distance = (trip.endodo || 0) - (trip.startodo || 0);
            if (distance > 0) batchTotalDistance += distance;

            batchTotalEnergy += Math.abs(trip.endkwh - trip.startkwh);

            const duration = formatEpochToDuration(
              (trip.movingtime || 0) + (trip.idletime || 0)
            );
            const socconsumed = (trip.startsoc || 0) - (trip.endsoc || 0);

            let boostmode = 0;
            if (distance > 0 && trip.boostdist != null && trip.boostdist > 0) {
              // Fallback to distance-based calculation
              boostmode = (trip.boostdist / distance) * 100;
            } else if (socconsumed > 0 && trip.boostsocusage != null && trip.boostsocusage > 0) {
              boostmode = (trip.boostsocusage / socconsumed) * 100;
            } else if (duration > 0 && trip.boostduration != null && trip.boostduration > 0) {
              boostmode = (trip.boostduration / duration) * 100;
            }
            boostmode = Math.max(0, Math.min(100, boostmode));
            boostmode = Math.round(boostmode);
            const ecomode = 100 - Math.round(boostmode);
            const maxspeed =
              typeof trip.maxspeed === "number" ? trip.maxspeed : 0;
            const idleTime = formatEpochToDuration(trip.idletime || 0);
            let drivingModes = [];
            let tripDrivingModes = trip?.drivemodes || {};
            let vinModel = '';
            let vinModes = [];
            if(tripDrivingModes && tripDrivingModes.length > 0) {
              tripDrivingModes = JSON.parse(tripDrivingModes);
              vinModel = tripDrivingModes?.model || '';
              vinModes = tripDrivingModes?.modes || [];
            }else{
              vinModel = vinToRegnoMap[vin].modelfamilycode || '';
            }
            
            if (vinModel && vinModel !== '') {
              const allModelModes = DRIVING_MODES[vinModel];
              drivingModes = allModelModes.map((modeObj) => ({
                mode: modeObj.mode,
                value: '0%',
                color: modeObj.color
              }));
              if(vinModes && vinModes.length > 0) {
                if (vinModes.length === 1) {
                  const singleMode = vinModes[0];
                  const modeName = singleMode.mode?.toLowerCase();
                  const modeIndex = drivingModes.findIndex(m => m.mode.toLowerCase() === modeName);
                  if (modeIndex !== -1) {
                    drivingModes[modeIndex].value = '100%';
                  }
                } else {
                  let totalDistance = 0;
                  vinModes.forEach((mode) => {
                    if(mode.mode && DRIVING_MODE_TYPE[mode.mode]) {
                      totalDistance += mode.distancetravelled || 0;
                    }
                  });
                  
                  if (totalDistance > 0) {
                    const percentages = [];
                    vinModes.forEach((mode) => {
                      const modeName = mode.mode?.toLowerCase();
                      const modeIndex = drivingModes.findIndex(m => m.mode.toLowerCase() === modeName);
                      if (modeIndex !== -1) {
                        const percentage = (mode.distancetravelled / totalDistance) * 100;
                        percentages.push({
                          index: modeIndex,
                          value: percentage,
                          floor: Math.floor(percentage),
                          remainder: percentage - Math.floor(percentage)
                        });
                      }
                    });
                    const totalFloor = percentages.reduce((sum, p) => sum + p.floor, 0);
                    const remainder = 100 - totalFloor;

                    percentages.sort((a, b) => b.remainder - a.remainder);
                    
                    for (let i = 0; i < remainder && i < percentages.length; i++) {
                      percentages[i].floor += 1;
                    }

                    percentages.forEach((p) => {
                      drivingModes[p.index].value = `${p.floor}%`;
                    });
                  }
                }
              } 
            } else {
                const ecoPercentage = ecomode;
                const boostPercentage = boostmode;
                const totalPercentage = ecoPercentage + boostPercentage;
                
                if (totalPercentage > 0) {
                  const normalizedEco = (ecoPercentage / totalPercentage) * 100;
                  const normalizedBoost = (boostPercentage / totalPercentage) * 100;
                  
                  const ecoFloor = Math.floor(normalizedEco);
                  const boostFloor = Math.floor(normalizedBoost);
                  const remainder = 100 - ecoFloor - boostFloor;
                  
                  const ecoRemainder = normalizedEco - ecoFloor;
                  const boostRemainder = normalizedBoost - boostFloor;
                  
                  let finalEco = ecoFloor;
                  let finalBoost = boostFloor;
                  
                  if (remainder > 0) {
                    if (ecoRemainder >= boostRemainder) {
                      finalEco += remainder;
                    } else {
                      finalBoost += remainder;
                    }
                  }
                  
                  for(const mode of drivingModes) {
                    const modeName = mode.mode?.toLowerCase();
                    if(modeName && (modeName === 'eco' || modeName === 'range')) {
                      mode.value = `${finalEco}%`;
                    } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
                      mode.value = `${finalBoost}%`;
                    }
                  }
                }
              }


            batchVehicles[vin].trips.push({
              starttime: formatEpochToDateTime(trip.starttime),
              endtime: formatEpochToDateTime(trip.endtime),
              startlat: safeCoord(trip.startlat),
              endlat: safeCoord(trip.endlat),
              startlng: safeCoord(trip.startlng),
              endlng: safeCoord(trip.endlng),
              distance: `${parseFloat(distance.toFixed(2))} km`,
              maxspeed: `${parseFloat(maxspeed.toFixed(2))} km/h`,
              socconsumed: `${parseFloat(socconsumed.toFixed(2))}%`,
              duration,
              drivemodes: drivingModes,
              ecomode: `${ecomode}%`,
              boostmode: `${boostmode}%`,
              idleTime: idleTime,
              // Add original epoch timestamp for sorting
              _startEpoch: trip.starttime,
            });
          });

          batchTotalTrips = batch.length;
          return {
            batchVehicles,
            batchTotalTrips,
            batchTotalDistance,
            batchTotalEnergy,
          };
        })
      );

      // Aggregate all batch results
      let totaltrips = 0;
      let totaldistancetravelled = 0;
      let totalenergyconsumed = 0;
      let vehicles = {};

      for (const result of batchResults) {
        totaltrips += result.batchTotalTrips;
        totaldistancetravelled += result.batchTotalDistance;
        totalenergyconsumed += result.batchTotalEnergy;
        // Merge vehicles
        for (const vin in result.batchVehicles) {
          const regno = vinToRegnoMap[vin].license_plate;
          if (!vehicles[vin]) {
            vehicles[vin] = { regno: regno, tripcount: 0, trips: [] };
          }
          vehicles[vin].regno = regno;
          vehicles[vin].tripcount += result.batchVehicles[vin].tripcount;
          vehicles[vin].trips.push(...result.batchVehicles[vin].trips);
        }
      }

      for (const vin in vehicles) {
        vehicles[vin].trips.sort((a, b) => {
          // Use the original epoch timestamp for comparison
          return b._startEpoch - a._startEpoch; // Reverse order (newest first)
        });
        // Remove the temporary _startEpoch field after sorting
        vehicles[vin].trips.forEach((trip) => {
          delete trip._startEpoch;
        });
      }

      return {
        totaltrips: toFormattedString(totaltrips),
        totaldistancetravelled: `${toFormattedString(
          totaldistancetravelled
        )} km`,
        totalenergyconsumed: `${toFormattedString(totalenergyconsumed)} kWh`,
        vehicles,
      };
    } catch (error) {
      this.logger.error("Error in ProcessTripData:", error);
      throw error;
    }
  };

  GetTripsByVehicleLogic = async (accountid, vinno, starttime, endtime) => {
    let result = await this.tripsinsightssvcI.GetTripsByVehicle(
      accountid,
      vinno,
      starttime,
      endtime
    );

    if (!result) {
      this.logger.error("Failed to get vehicle trips data");
      throw new Error("Failed to get vehicle trips data");
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

    const regnodata = await this.fmsAccountSvcI.GetRegno([vinno]);
    const vinToRegnoMap = {};
    regnodata.forEach(({ vinno, license_plate }) => {
      if (license_plate && license_plate.trim() !== "") {
        vinToRegnoMap[vinno] = license_plate;
      } else {
        vinToRegnoMap[vinno] = `${vinno}`;
      }
    });

    if (Array.isArray(result)) {
      result = result.map((trip) => {
        const distance = trip.endodo - trip.startodo;

        const duration = (trip.movingtime || 0) + (trip.idletime || 0);

        const socconsumed = trip.startsoc - trip.endsoc;

        let boostmode = 0;
        let ecomode = 0;

        let tripDrivingModes = trip?.drivemodes || {};
        if(tripDrivingModes && tripDrivingModes.length > 0) {
          tripDrivingModes = JSON.parse(tripDrivingModes);
        }
        const vinModel = tripDrivingModes?.model || '';
        const vinModes = tripDrivingModes?.modes || [];
        if (vinModel && vinModel !== '') {
          let totalDuration = 0;
          let ecomodeDuration = 0;
          let boostmodeDuration = 0;
          for (const mode of vinModes) {
            const modeName = mode.mode?.toLowerCase();
            if (modeName && (modeName === 'eco' || modeName === 'range' || modeName === 'ride' || modeName === 'eccopluse')) {
              totalDuration += mode.duration || 0;
              ecomodeDuration += mode.duration || 0;
            } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
              totalDuration += mode.duration || 0;
              boostmodeDuration += mode.duration || 0;
            }
          }
          if (totalDuration > 0) {
            ecomode = Math.round((ecomodeDuration / totalDuration) * 100);
            boostmode = Math.round((boostmodeDuration / totalDuration) * 100);
          }
        } else {
          if (socconsumed > 0 && trip.boostsocusage != null && trip.boostsocusage > 0) {
            boostmode = (trip.boostsocusage / socconsumed) * 100;
          } else if (duration > 0 && trip.boostduration != null && trip.boostduration > 0) {
            // Fallback to duration-based calculation
            boostmode = (trip.boostduration / duration) * 100;
          } else if (distance > 0 && trip.boostdist != null && trip.boostdist > 0) {
            // Fallback to distance-based calculation
            boostmode = (trip.boostdist / distance) * 100;
          }
          boostmode = Math.max(0, Math.min(100, boostmode));
          ecomode = 100 - Math.round(boostmode);
        }
        const energyconsumed = Math.abs(trip.endkwh - trip.startkwh);

        const calcrange =
          typeof trip.calcrange === "number" ? trip.calcrange : 0;

        const maxspeed = typeof trip.maxspeed === "number" ? trip.maxspeed : 0;

        return {
          ...trip,
          regno: vinToRegnoMap[trip.vin] || `${trip.vin}`,
          modeldisplayname: modeldisplayname,
          distance: Math.round(distance * 100) / 100,
          duration: Math.round(duration * 100) / 100,
          socconsumed: Math.round(socconsumed * 100) / 100,
          energyconsumed: Math.round(energyconsumed * 100) / 100,
          calcrange: Math.round(calcrange * 100) / 100,
          energyconsumedkwh: `${Math.round(energyconsumed * 100) / 100} kWh`,
          boostmode: boostmode,
          ecomode: ecomode,
          maxspeed: Math.round(maxspeed * 100) / 100,
          distancekm: `${Math.round(distance * 100) / 100} km`,
          durationformatted: formatEpochToDuration(duration),
          socconsumedpercent: `${Math.round(socconsumed * 100) / 100}%`,
          calcrangekm: `${Math.round(calcrange * 100) / 100} km`,
          boostmodepercent: `${boostmode}%`,
          ecomodepercent: `${ecomode}%`,
          maxspeedkmh: `${Math.round(maxspeed * 100) / 100} km/h`,
        };
      });
    }

    return result;
  };

  GetTripsByFleetLogic = async (
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
      return [];
    }

    const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);

    let [result, regnodata] = await Promise.all([
      this.tripsinsightssvcI.GetTripsByFleet(vinNumbers, starttime, endtime),
      this.fmsAccountSvcI.GetRegno(vinNumbers),
    ]);

    if (!result) {
      this.logger.error("Failed to get fleet trips data");
      throw new Error("Failed to get fleet trips data");
    }

    const vinToRegnoMap = {};
    regnodata.forEach(({ vinno, license_plate }) => {
      if (license_plate && license_plate.trim() !== "") {
        vinToRegnoMap[vinno] = license_plate;
      } else {
        vinToRegnoMap[vinno] = `${vinno}`;
      }
    });

    const vinToModelDisplayNameMap = {};
    vehicles.forEach((vehicle) => {
      vinToModelDisplayNameMap[vehicle.vinno] =
        vehicle.modeldisplayname || "Unknown Model";
    });

    if (Array.isArray(result)) {
      result = result.map((trip) => {
        const distance = trip.endodo - trip.startodo;

        const duration = (trip.movingtime || 0) + (trip.idletime || 0);

        const socconsumed = trip.startsoc - trip.endsoc;

        let boostmode = 0;
        let ecomode = 0;

        let totalDuration = 0;
        let tripDrivingModes = trip?.drivemodes || {};
        if(tripDrivingModes && tripDrivingModes.length > 0) {
          tripDrivingModes = JSON.parse(tripDrivingModes);
        }
        const vinModel = tripDrivingModes?.model || '';
        const vinModes = tripDrivingModes?.modes || [];
        if (vinModel && vinModel !== '') {
          let ecomodeDuration = 0;
          let boostmodeDuration = 0;
          for (const mode of vinModes) {
            const modeName = mode.mode?.toLowerCase();
            if (modeName && (modeName === 'eco' || modeName === 'range' || modeName === 'ride' || modeName === 'eccopluse')) {
              totalDuration += mode.duration || 0;
              ecomodeDuration += mode.duration || 0;
            } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
              totalDuration += mode.duration || 0;
              boostmodeDuration += mode.duration || 0;
            }
          }
          if (totalDuration > 0) {
            ecomode = Math.round((ecomodeDuration / totalDuration) * 100);
            boostmode = Math.round((boostmodeDuration / totalDuration) * 100);
          }
        }  else {
          if (socconsumed > 0 && trip.boostsocusage != null && trip.boostsocusage > 0) {
            boostmode = (trip.boostsocusage / socconsumed) * 100;
          } else if (duration > 0 && trip.boostduration != null && trip.boostduration > 0) {
            // Fallback to duration-based calculation
            boostmode = (trip.boostduration / duration) * 100;
          } else if (distance > 0 && trip.boostdist != null && trip.boostdist > 0) {
            // Fallback to distance-based calculation
            boostmode = (trip.boostdist / distance) * 100;
          }
          boostmode = Math.max(0, Math.min(100, boostmode));
          ecomode = 100 - Math.round(boostmode);
        }

        const energyconsumed = Math.abs(trip.endkwh - trip.startkwh);
        const calcrange =
          typeof trip.calcrange === "number" ? trip.calcrange : 0;

        const maxspeed = typeof trip.maxspeed === "number" ? trip.maxspeed : 0;

        return {
          ...trip,
          regno: vinToRegnoMap[trip.vin] || `${trip.vin}`,
          modeldisplayname:
            vinToModelDisplayNameMap[trip.vin] || "Unknown Model",
          distance: Math.round(distance * 100) / 100,
          duration: Math.round(duration * 100) / 100,
          socconsumed: Math.round(socconsumed * 100) / 100,
          energyconsumed: Math.round(energyconsumed * 100) / 100,
          energyconsumedkwh: `${Math.round(energyconsumed * 100) / 100} kWh`,
          calcrange: Math.round(calcrange * 100) / 100,
          boostmode: boostmode,
          ecomode: ecomode,
          maxspeed: Math.round(maxspeed * 100) / 100,
          distancekm: `${Math.round(distance * 100) / 100} km`,
          durationformatted: formatEpochToDuration(duration),
          socconsumedpercent: `${Math.round(socconsumed * 100) / 100}%`,
          calcrangekm: `${Math.round(calcrange * 100) / 100} km`,
          boostmodepercent: `${boostmode}%`,
          ecomodepercent: `${ecomode}%`,
          maxspeedkmh: `${Math.round(maxspeed * 100) / 100} km/h`,
        };
      });
    }

    return result;
  };

  GetActiveVehicleDataByVinLogic = async (
    accountid,
    vinno,
    starttime,
    endtime
  ) => {
    try {
      let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
      if (!rootFleetId) {
        this.logger.info("Root fleet not found for account");
        return {
          totaltrips: 0,
          vehiclemodel: "",
          vehiclevariant: "",
          activevehicles: {},
          activevehiclesmodelwise: {},
          kmdrivenandactivehours: {},
        };
      }

      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        rootFleetId,
        true
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the account");
        return {
          totaltrips: 0,
          vehiclemodel: "",
          vehiclevariant: "",
          activevehicles: {},
          activevehiclesmodelwise: {},
          kmdrivenandactivehours: {},
        };
      }

      let vehicle = vehicles.find((v) => v.vinno === vinno);
      if (!vehicle) {
        this.logger.info("Vehicle not found");
        return {
          totaltrips: 0,
          vehiclemodel: "",
          vehiclevariant: "",
          activevehicles: {},
          activevehiclesmodelwise: {},
          kmdrivenandactivehours: {},
        };
      }

      let tripData = await this.tripsinsightssvcI.GetTripsByVehicle(
        accountid,
        vinno,
        starttime,
        endtime
      );
      if (!tripData) {
        this.logger.error("Failed to get vehicle trips data");
        throw new Error("Failed to get vehicle trips data");
      }

      const activevehiclecount = {};
      const activevehiclemodelwise = {};
      const kmdrivenandactivehours = {};

      if (tripData && tripData.length > 0) {
        tripData.forEach((trip) => {
          if (trip.starttime) {
            const tripDate = new Date(parseInt(trip.starttime));
            const dateKey = this.formatDateToIST(tripDate);

            if (!activevehiclecount[dateKey]) {
              activevehiclecount[dateKey] = 0;
            }
            activevehiclecount[dateKey] = 1;

            // Add model-wise tracking
            const modelKey = `${vehicle.vehiclemodel} ${vehicle.vehiclevariant}`;
            if (!activevehiclemodelwise[dateKey]) {
              activevehiclemodelwise[dateKey] = {};
            }
            if (!activevehiclemodelwise[dateKey][modelKey]) {
              activevehiclemodelwise[dateKey][modelKey] = 0;
            }
            activevehiclemodelwise[dateKey][modelKey] = 1;

            if (!kmdrivenandactivehours[dateKey]) {
              kmdrivenandactivehours[dateKey] = {
                kmdriven: 0,
                activehours: 0,
              };
            }

            const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
            kmdrivenandactivehours[dateKey].kmdriven += tripDistance;

            const movingTimeHours = (trip.movingtime || 0) / (1000 * 60 * 60);
            kmdrivenandactivehours[dateKey].activehours += movingTimeHours;
          }
        });
      }

      const processedKmdrivenandactivehours = {};
      Object.keys(kmdrivenandactivehours).forEach((date) => {
        processedKmdrivenandactivehours[date] = {
          kmdriven:
            Math.round(kmdrivenandactivehours[date].kmdriven * 100) / 100,
          activehours:
            Math.round(kmdrivenandactivehours[date].activehours * 100) / 100,
        };
      });

      return {
        totaltrips: tripData ? tripData.length : 0,
        vehiclemodel: vehicle.vehiclemodel || "",
        vehiclevariant: vehicle.vehiclevariant || "",
        activevehicles: activevehiclecount,
        activevehiclesmodelwise: activevehiclemodelwise,
        kmdrivenandactivehours: processedKmdrivenandactivehours,
      };
    } catch (error) {
      this.logger.error("Error in GetActiveVehicleDataByVinLogic:", error);
      throw error;
    }
  };

  GetActiveVehiclesByFleetLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive = false
  ) => {
    try {
      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the fleet");
        return {
          totalvehiclecount: 0,
          totaltrips: 0,
          activevehicles: {},
          activevehiclesmodelwise: {},
          kmdrivenandactivehours: {},
        };
      }

      const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);
      const vinToModelDisplayNameMap = {};
      vehicles.forEach((vehicle) => {
        vinToModelDisplayNameMap[vehicle.vinno] = vehicle.modeldisplayname || "";
      });

      let tripData = await this.tripsinsightssvcI.GetTripsByFleet(
        vinNumbers,
        starttime,
        endtime
      );
      if (!tripData) {
        this.logger.error("Failed to get fleet trips data");
        throw new Error("Failed to get fleet trips data");
      }

      const vehicleMap = {};
      vehicles.forEach((vehicle) => {
        vehicleMap[vehicle.vinno] = vehicle;
      });

      const activevehiclecount = {};
      const activevehiclemodelwise = {};
      const kmdrivenandactivehours = {};

      if (tripData && tripData.length > 0) {
        tripData.forEach((trip) => {
          if (trip.starttime) {
            const tripDate = new Date(parseInt(trip.starttime));
            const dateKey = this.formatDateToIST(tripDate);
            const vehicle = vehicleMap[trip.vin];

            if (vehicle) {
              if (!activevehiclecount[dateKey]) {
                activevehiclecount[dateKey] = new Set();
              }
              activevehiclecount[dateKey].add(trip.vin);

              const modelKey = `${vinToModelDisplayNameMap[trip.vin] || ""}`;
              if (!activevehiclemodelwise[dateKey]) {
                activevehiclemodelwise[dateKey] = {};
              }
              if (!activevehiclemodelwise[dateKey][modelKey]) {
                activevehiclemodelwise[dateKey][modelKey] = new Set();
              }
              activevehiclemodelwise[dateKey][modelKey].add(trip.vin);

              if (!kmdrivenandactivehours[dateKey]) {
                kmdrivenandactivehours[dateKey] = {
                  kmdriven: 0,
                  activehours: 0,
                };
              }

              const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
              kmdrivenandactivehours[dateKey].kmdriven += tripDistance;

              const movingTimeHours = (trip.movingtime || 0) / (1000 * 60 * 60);
              kmdrivenandactivehours[dateKey].activehours += movingTimeHours;
            }
          }
        });
      }

      const processedActivevehiclecount = {};
      Object.keys(activevehiclecount).forEach((date) => {
        processedActivevehiclecount[date] = activevehiclecount[date].size;
      });

      const processedActivevehiclemodelwise = {};
      Object.keys(activevehiclemodelwise).forEach((date) => {
        processedActivevehiclemodelwise[date] = {};
        Object.keys(activevehiclemodelwise[date]).forEach((model) => {
          processedActivevehiclemodelwise[date][model] =
            activevehiclemodelwise[date][model].size;
        });
      });

      const processedKmdrivenandactivehours = {};
      Object.keys(kmdrivenandactivehours).forEach((date) => {
        processedKmdrivenandactivehours[date] = {
          kmdriven:
            Math.round(kmdrivenandactivehours[date].kmdriven * 100) / 100,
          activehours:
            Math.round(kmdrivenandactivehours[date].activehours * 100) / 100,
        };
      });

      return {
        totalvehiclecount: vehicles.length,
        totaltrips: tripData ? tripData.length : 0,
        activevehicles: processedActivevehiclecount,
        activevehiclesmodelwise: processedActivevehiclemodelwise,
        kmdrivenandactivehours: processedKmdrivenandactivehours,
      };
    } catch (error) {
      this.logger.error("Error in GetActiveVehiclesByFleetLogic:", error);
      throw error;
    }
  };

  GetFleetUtilizationLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive = false
  ) => {
    try {
      // const weekstarttime = this.getWeekStarttime(starttime);
      // const weekendtime = this.getWeekEndtime(endtime);
      const weekstarttime = starttime;
      const weekendtime = endtime;

      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the fleet");
        return {
          totalvehiclecount: 0,
          totaltrips: 0,
          weekData: {},
        };
      }

      const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);

      let tripData = await this.tripsinsightssvcI.GetTripsByFleet(
        vinNumbers,
        weekstarttime,
        weekendtime
      );
      if (!tripData) {
        this.logger.error("Failed to get fleet trips data");
        throw new Error("Failed to get fleet trips data");
      }

      const weekData = this.calculateWeekBuckets(
        weekstarttime,
        weekendtime,
        tripData
      );

      return {
        totalvehiclecount: vehicles.length,
        totaltrips: tripData ? tripData.length : 0,
        weekData,
      };
    } catch (error) {
      this.logger.error("Error in GetFleetUtilizationLogic:", error);
      throw error;
    }
  };

  GetFleetUtilizationForVehicleLogic = async (
    accountid,
    vinno,
    starttime,
    endtime
  ) => {
    try {
      // const weekstarttime = this.getWeekStarttime(starttime);
      // const weekendtime = this.getWeekEndtime(endtime);
      const weekstarttime = starttime;
      const weekendtime = endtime;

      let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
      if (!rootFleetId) {
        this.logger.info("Root fleet not found for account");
        return {
          totalvehiclecount: 0,
          totaltrips: 0,
          weekData: {},
        };
      }

      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        rootFleetId,
        true
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the account");
        return {
          totalvehiclecount: 0,
          totaltrips: 0,
          weekData: {},
        };
      }

      let vehicle = vehicles.find((v) => v.vinno === vinno);
      if (!vehicle) {
        this.logger.info("Vehicle not found");
        return {
          totalvehiclecount: 0,
          totaltrips: 0,
          weekData: {},
        };
      }

      let tripData = await this.tripsinsightssvcI.GetTripsByVehicle(
        accountid,
        vinno,
        weekstarttime,
        weekendtime
      );
      if (!tripData) {
        this.logger.error("Failed to get vehicle trips data");
        throw new Error("Failed to get vehicle trips data");
      }

      const weekData = this.calculateWeekBuckets(
        weekstarttime,
        weekendtime,
        tripData
      );

      return {
        totalvehiclecount: 1,
        totaltrips: tripData ? tripData.length : 0,
        weekData,
      };
    } catch (error) {
      this.logger.error("Error in GetFleetUtilizationForVehicleLogic:", error);
      throw error;
    }
  };

  GetFleetDrivingModeLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive = false
  ) => {
    try {
      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the fleet");
        return {
          activevehicles: {},
          drivingmodeusage: {},
          rangecomparison: {},
        };
      }

      const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);

      let tripData = await this.tripsinsightssvcI.GetTripsByFleet(
        vinNumbers,
        starttime,
        endtime
      );
      if (!tripData) {
        this.logger.error("Failed to get fleet trips data");
        throw new Error("Failed to get fleet trips data");
      }

      const activevehicles = this.calculateActiveVehiclesByDay(
        starttime,
        tripData
      );
      const drivingmodeusage = this.calculateDrivingModeUsage(
        starttime,
        tripData,
        vinNumbers.length
      );
      // TODO: Implement range comparison
      const rangecomparison = {};

      return {
        activevehicles,
        drivingmodeusage,
        rangecomparison,
      };
    } catch (error) {
      this.logger.error("Error in GetFleetDrivingModeLogic:", error);
      throw error;
    }
  };

  GetVehicleDrivingModeLogic = async (accountid, vinno, starttime, endtime) => {
    try {
      let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
      if (!rootFleetId) {
        this.logger.info("Root fleet not found for account");
        return {
          activevehicles: {},
          drivingmodeusage: {},
          rangecomparison: {},
        };
      }

      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        rootFleetId,
        true
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the account");
        return {
          activevehicles: {},
          drivingmodeusage: {},
          rangecomparison: {},
        };
      }

      let vehicle = vehicles.find((v) => v.vinno === vinno);
      if (!vehicle) {
        this.logger.info("Vehicle not found");
        return {
          activevehicles: {},
          drivingmodeusage: {},
          rangecomparison: {},
        };
      }

      let tripData = await this.tripsinsightssvcI.GetTripsByVehicle(
        accountid,
        vinno,
        starttime,
        endtime
      );
      if (!tripData) {
        this.logger.error("Failed to get vehicle trips data");
        throw new Error("Failed to get vehicle trips data");
      }

      const activevehicles = this.calculateActiveVehiclesByDay(
        starttime,
        tripData
      );
      const drivingmodeusage = this.calculateDrivingModeUsage(
        starttime,
        tripData,
        1
      );
      // TODO: Implement range comparison
      const rangecomparison = {};

      return {
        activevehicles,
        drivingmodeusage,
        rangecomparison,
      };
    } catch (error) {
      this.logger.error("Error in GetVehicleDrivingModeLogic:", error);
      throw error;
    }
  };


    // Common helper function to calculate status for any metric with three-tier logic
    calculateStatusForMetric = (value, category) => {
      const BOOST_MODE_THRESHOLD = 30;
      const ECO_MODE_THRESHOLD = 70;
      const IDLE_TIME_THRESHOLD = 5; // minutes - base threshold
      const SHORT_TRIP_PERCENTAGE_THRESHOLD = 30;
      
      // Define ranges for "within_threshold" (average) status based on thresholds
      // For percentage-based metrics: use threshold as the good/bad boundary, with 40% range for average
      const ECO_MODE_GOOD_MIN = ECO_MODE_THRESHOLD; // >= 70% = good (below_threshold)
      const ECO_MODE_BAD_MAX = ECO_MODE_THRESHOLD - 40; // < 30% = bad (above_threshold)
      // 30-70% = average (within_threshold)
      
      const BOOST_MODE_GOOD_MAX = BOOST_MODE_THRESHOLD; // <= 30% = good (below_threshold)
      const BOOST_MODE_BAD_MIN = BOOST_MODE_THRESHOLD + 40; // > 70% = bad (above_threshold)
      // 30-70% = average (within_threshold)
      
      const SHORT_TRIPS_GOOD_MAX = SHORT_TRIP_PERCENTAGE_THRESHOLD; // <= 30% = good (below_threshold)
      const SHORT_TRIPS_BAD_MIN = SHORT_TRIP_PERCENTAGE_THRESHOLD + 40; // > 70% = bad (above_threshold)
      // 30-70% = average (within_threshold)
      
      // For idle_time: use threshold (5) as base, with multipliers for good/bad boundaries
      // Good: < 2x threshold (10min), Bad: > 4x threshold (20min), Average: 2x-4x threshold (10-20min)
      const IDLE_TIME_GOOD_MAX = IDLE_TIME_THRESHOLD * 2; // < 10min = good (below_threshold)
      const IDLE_TIME_BAD_MIN = IDLE_TIME_THRESHOLD * 4; // > 20min = bad (above_threshold)
      // 10-20min = average (within_threshold)
  
      switch (category) {
        case "eco_mode":
          // Higher is better for eco mode
          // >= ECO_MODE_THRESHOLD (70%) = good (below_threshold), < (ECO_MODE_THRESHOLD - 40) (30%) = bad (above_threshold), 30-70% = average (within_threshold)
          if (value >= ECO_MODE_GOOD_MIN) {
            return "below_threshold"; // Good
          } else if (value < ECO_MODE_BAD_MAX) {
            return "above_threshold"; // Bad
          } else {
            return "within_threshold"; // Average
          }
  
        case "boost_mode":
          // Lower is better for boost mode
          // <= BOOST_MODE_THRESHOLD (30%) = good (below_threshold), > (BOOST_MODE_THRESHOLD + 40) (70%) = bad (above_threshold), 30-70% = average (within_threshold)
          if (value <= BOOST_MODE_GOOD_MAX) {
            return "below_threshold"; // Good
          } else if (value > BOOST_MODE_BAD_MIN) {
            return "above_threshold"; // Bad
          } else {
            return "within_threshold"; // Average
          }
  
        case "short_trips":
          // Lower is better for short trips percentage
          // <= SHORT_TRIP_PERCENTAGE_THRESHOLD (30%) = good (below_threshold), > (SHORT_TRIP_PERCENTAGE_THRESHOLD + 40) (70%) = bad (above_threshold), 30-70% = average (within_threshold)
          if (value <= SHORT_TRIPS_GOOD_MAX) {
            return "below_threshold"; // Good
          } else if (value > SHORT_TRIPS_BAD_MIN) {
            return "above_threshold"; // Bad
          } else {
            return "within_threshold"; // Average
          }
  
        case "idle_time":
          // Lower is better for idle time
          // < (IDLE_TIME_THRESHOLD * 2) (10min) = good (below_threshold), > (IDLE_TIME_THRESHOLD * 4) (20min) = bad (above_threshold), 10-20min = average (within_threshold)
          if (value < IDLE_TIME_GOOD_MAX) {
            return "below_threshold"; // Good
          } else if (value > IDLE_TIME_BAD_MIN) {
            return "above_threshold"; // Bad
          } else {
            return "within_threshold"; // Average
          }
  
        default:
          return "within_threshold";
      }
    };

  // Common function to calculate fleet metrics - used by both functions
  calculateFleetMetrics = (tripData, allTripData) => {
    const SHORT_TRIP_DISTANCE = 2;

    let totalIdleTime = 0;
    let totalBoostSocUsage = 0;
    let totalSocUsage = 0;
    let totalBoostDistance = 0;
    let totalDistance = 0;
    let totalBoostDuration = 0;
    let totalDuration = 0;
    
    // Use already-calculated boostmode/ecomode from GetTripsByFleetLogic
    // But we need raw data for accurate aggregate calculation
    tripData.forEach((trip) => {
      let distance = 0;
      let boostDistance = 0;
      let boostSocUsage = 0;
      let tripSocUsage = 0;
      let boostDuration = 0;
      let tripDuration = 0;

      let driveModes = trip.drivemodes || {};
      if(driveModes && driveModes.length > 0) {
        driveModes = JSON.parse(driveModes);
      }
      const modes = driveModes.modes || [];
      if(modes && modes.length > 0) {
        modes.forEach(mode => {
          const modeName = mode.mode?.toLowerCase();
          if (modeName && (modeName === 'eco' || modeName === 'range' || modeName === 'ride' || modeName === 'eccopluse')) {
            distance += mode.distancetravelled || 0;
            tripSocUsage += mode.socconsumed || 0;
            tripDuration += mode.duration || 0;
          } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
            boostDistance += mode.distancetravelled || 0;
            boostSocUsage += mode.socconsumed || 0;
            boostDuration += mode.duration || 0;
            distance += mode.distancetravelled || 0;
            tripSocUsage += mode.socconsumed || 0;
            tripDuration += mode.duration || 0;
          }
        } )

      }  else {
        distance = trip.endodo - trip.startodo;

        tripDuration = (trip.movingtime || 0) + (trip.idletime || 0);

        tripSocUsage = trip.startsoc - trip.endsoc;
        if (tripSocUsage > 0 && trip.boostsocusage != null && trip.boostsocusage > 0) {
          boostSocUsage += (trip.boostsocusage || 0);
        } else if (tripDuration > 0 && trip.boostduration != null && trip.boostduration > 0) {
          // Fallback to duration-based calculation
          boostDuration += (trip.boostduration || 0);
        } else if (distance > 0 && trip.boostdist != null && trip.boostdist > 0) {
          // Fallback to distance-based calculation
          boostDistance += (trip.boostdist || 0);
        }
      }
      if (distance > 0) {
        totalDistance += distance;
        totalBoostDistance += Math.min(boostDistance, distance);
      }

      totalIdleTime += trip.idletime || 0;
      totalBoostSocUsage += boostSocUsage;
      totalSocUsage += tripSocUsage;
      totalBoostDuration += boostDuration;
      totalDuration += tripDuration;
    });
    

    let shortTrips = 0;
    let totalAllTrips = allTripData.length;
    let totalAllDistance = 0;

    allTripData.forEach((trip) => {
      const distance = (trip.endodo || 0) - (trip.startodo || 0);

      if (distance > 0) {
        totalAllDistance += distance;

        if (distance < SHORT_TRIP_DISTANCE) {
          shortTrips++;
        }
      }
    });

    // Calculate aggregate boost mode percentage using SOC-based approach (primary)
    // Fallback to duration-based, then distance-based
    let boostModePercentage = 0;
    if (totalSocUsage > 0 && totalBoostSocUsage > 0) {
      boostModePercentage = (totalBoostSocUsage / totalSocUsage) * 100;
    } else if (totalDuration > 0 && totalBoostDuration > 0) {
      boostModePercentage = (totalBoostDuration / totalDuration) * 100;
    } else if (totalDistance > 0) {
      boostModePercentage = (totalBoostDistance / totalDistance) * 100;
    }
    boostModePercentage = Math.max(0, Math.min(100, boostModePercentage));
    const ecoModePercentage = 100 - Math.round(boostModePercentage);
    
    const averageIdleTimePerTrip =
      tripData.length > 0 ? totalIdleTime / tripData.length / (1000 * 60) : 0;
    const shortTripPercentage =
      totalAllTrips > 0 ? (shortTrips / totalAllTrips) * 100 : 0;

    // Calculate status using common function
    const boostStatus = this.calculateStatusForMetric(boostModePercentage, "boost_mode");
    const ecoStatus = this.calculateStatusForMetric(ecoModePercentage, "eco_mode");
    const idleStatus = this.calculateStatusForMetric(averageIdleTimePerTrip, "idle_time");
    const shortTripsStatus = this.calculateStatusForMetric(shortTripPercentage, "short_trips");

    return {
      boostModePercentage,
      ecoModePercentage,
      averageIdleTimePerTrip,
      shortTripPercentage,
      totalAllDistance,
      totalAllTrips,
      boostStatus,
      ecoStatus,
      idleStatus,
      shortTripsStatus,
    };
  };

  // Update GetFleetOverviewLogic to use processed trips
  GetFleetOverviewLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive = false
  ) => {
    try {
      // Get all processed trips from GetTripsByFleetLogic
      const allTripData = await this.GetTripsByFleetLogic(accountid, fleetid, starttime, endtime, recursive);
      
      // Get vehicles for vehicle count
      const vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      );

      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the fleet");
        return {
          insights: this.getDefaultInsights(),
          drilldowndata: this.getDefaultDrillDown(),
        };
      }

      if (!allTripData || allTripData.length === 0) {
        this.logger.info("No trip data found for the fleet");
        return {
          insights: this.getDefaultInsights(),
          drilldowndata: this.getDefaultDrillDown(),
        };
      }

      // Filter trips with distance > 2km for metrics calculation
      const tripData = allTripData.filter((trip) => {
        const distance = (trip.endodo || 0) - (trip.startodo || 0);
        return distance > 2;
      });

      // Calculate metrics using the trip data
      const metrics = this.calculateFleetMetrics(tripData, allTripData);

      // Generate insights using calculated metrics
      const insights = this.buildInsightsFromMetrics(metrics);

      // Build date epoch map for drilldown
      const dateEpochMap = {};
      let currentEpoch = parseInt(starttime);
      const endEpoch = parseInt(endtime);
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      while (currentEpoch <= endEpoch) {
        const dateKey = this.formatDateToIST(new Date(currentEpoch));
        const startepoch = currentEpoch;
        const endepoch = currentEpoch + (ONE_DAY_MS - 1000);
        
        dateEpochMap[dateKey] = { startepoch, endepoch };
        currentEpoch += ONE_DAY_MS;
      }

      // Calculate drilldown using trip data
      const drilldowndata = this.calculateMetricDrillDownFromProcessedTrips(
        tripData,
        allTripData,
        starttime,
        endtime,
        dateEpochMap
      );

      return {
        insights,
        drilldowndata,
        totaltrips: allTripData.length,
        totalvehicles: vehicles.length,
        analysisperiod: {
          starttime: this.formatDateToIST(new Date(parseInt(starttime))),
          endtime: this.formatDateToIST(new Date(parseInt(endtime))),
        },
      };
    } catch (error) {
      this.logger.error("Error in GetFleetOverviewLogic:", error);
      throw error;
    }
  };

  // Update GetFleetOverviewListLogic to use processed trips
  GetFleetOverviewListLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    category,
    recursive
  ) => {
    try {
      if (!fleetid) throw new Error("Fleet ID is required");
  
      // Fetch vehicles
      const vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      );

      if (!vehicles || vehicles.length === 0) {
        return this.buildDefaultDateStructure(starttime, endtime);
      }

      // Fetch trip data using GetTripsByFleetLogic
      const allTrips = await this.GetTripsByFleetLogic(
        accountid,
        fleetid,
        starttime,
        endtime,
        recursive
      );

      if (!allTrips || allTrips.length === 0) {
        return this.buildDefaultDateStructure(starttime, endtime);
      }

      // Build date epoch map
      const dateEpochMap = {};
      let currentEpoch = parseInt(starttime);
      const endEpoch = parseInt(endtime);
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      while (currentEpoch <= endEpoch) {
        const dateKey = this.formatDateToIST(new Date(currentEpoch));
        const startepoch = currentEpoch;
        const endepoch = currentEpoch + (ONE_DAY_MS - 1000);
        dateEpochMap[dateKey] = { startepoch, endepoch };
        currentEpoch += ONE_DAY_MS;
      }

      // Build default date structure
      const tripsByDate = this.buildDefaultDateStructure(starttime, endtime);

      // Process each trip: group by date and calculate status
      allTrips.forEach((trip) => {
        // Skip trips outside time range
        if (!trip.starttime || trip.starttime < parseInt(starttime) || trip.starttime >= parseInt(endtime)) {
          return;
        }

        const tripDate = new Date(parseInt(trip.starttime));
        const dateKey = this.formatDateToIST(tripDate);
        
        if (!tripsByDate[dateKey]) {
          return; // Skip if date not in range
        }

        let distance = 0;
        let boostDistance = 0;
        let duration = 0;
        let boostDuration = 0;
        let boostSocUsage = 0;
        let tripSocUsage = 0;
        let boostModePercentage = 0;
        let driveModes = trip.drivemodes || {};
        if(driveModes && driveModes.length > 0) {
          driveModes = JSON.parse(driveModes);
        }
        const modes = driveModes.modes || [];
        if(modes && modes.length > 0) {
          modes.forEach(mode => {
            const modeName = mode.mode?.toLowerCase();
            if (modeName && (modeName === 'eco' || modeName === 'range' || modeName === 'ride' || modeName === 'eccopluse')) {
              distance += mode.distancetravelled || 0;
              tripSocUsage += mode.socconsumed || 0;
              duration += mode.duration || 0;
            } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
              boostDistance += mode.distancetravelled || 0;
              boostSocUsage += mode.socconsumed || 0;
              boostDuration += mode.duration || 0;
              distance += mode.distancetravelled || 0;
              tripSocUsage += mode.socconsumed || 0;
              duration += mode.duration || 0;
            }
          } )
          if (boostDistance > 0) {
            boostModePercentage = (boostDistance / distance) * 100;
          } else if (tripSocUsage > 0) {
            boostModePercentage = (boostSocUsage / tripSocUsage) * 100;
          } else if (duration > 0) {
            boostModePercentage = (boostDuration / duration) * 100;
          }
        }  else {

          distance = trip.endodo - trip.startodo;
  
          duration = (trip.movingtime || 0) + (trip.idletime || 0);
  
          tripSocUsage = trip.startsoc - trip.endsoc;
          if (tripSocUsage > 0 && trip.boostsocusage != null && trip.boostsocusage > 0) {
            boostModePercentage = (trip.boostsocusage / tripSocUsage) * 100;
          } else if (duration > 0 && trip.boostduration != null && trip.boostduration > 0) {
            // Fallback to duration-based calculation
            boostModePercentage = (trip.boostduration / duration) * 100;
          } else if (distance > 0 && trip.boostdist != null && trip.boostdist > 0) {
            // Fallback to distance-based calculation
            boostModePercentage = (trip.boostdist / distance) * 100;
          }
        }
        // Calculate status for this individual trip based on category
        let status;
        let shouldInclude = false;

        if (category === "boost_mode") {
          // Only include trips with distance > 2km for boost/eco mode
          if (distance > 2) {
            // boostmode is already a percentage (0-100) from GetTripsByFleetLogic
            status = this.calculateStatusForMetric(boostModePercentage, "boost_mode");
            shouldInclude = true;
          }
        } else if (category === "eco_mode") {
          // Only include trips with distance > 2km for boost/eco mode
          if (distance > 2) {
            // ecomode is already a percentage (0-100) from GetTripsByFleetLogic
            const ecoModePercentage = 100 - Math.round(boostModePercentage);
            status = this.calculateStatusForMetric(ecoModePercentage, "eco_mode");
            shouldInclude = true;
          }
        } else if (category === "idle_time") {
          // Convert idletime from milliseconds to minutes
          const idleTimeMinutes = trip.idletime ? trip.idletime / (1000 * 60) : 0;
          status = this.calculateStatusForMetric(idleTimeMinutes, "idle_time");
          shouldInclude = true;
        } else if (category === "short_trips") {
          // Only include short trips (< 2km)
          if (distance > 0 && distance < 2) {
            status = this.calculateStatusForMetric(100, "short_trips");
            shouldInclude = true;
          }
        } else {
          status = "within_threshold";
          shouldInclude = true;
        }

        // Add trip to date structure if it should be included
        if (shouldInclude) {
          tripsByDate[dateKey].push({
            vin: trip.vin,
            regno: trip.regno || `${trip.vin}`,
            starttime: formatEpochToDateTime(trip.starttime),
            endtime: formatEpochToDateTime(trip.endtime),
            duration: trip.durationformatted || formatEpochToDuration(trip.duration || 0),
            distance: trip.distancekm || `${trip.distance || 0} km`,
            startsoc: `${trip.startsoc || 0}%`,
            endsoc: `${trip.endsoc || 0}%`,
            socconsumed: trip.socconsumedpercent || `${trip.socconsumed || 0}%`,
            status: status,
          });
        }
      });
  
      return tripsByDate;
    } catch (error) {
      this.logger.error(
        "Error in GetFleetOverviewListLogic:",
        error
      );
      throw error;
    }
  };

  // Build insights from calculated metrics
  buildInsightsFromMetrics = (metrics) => {
    if (!metrics) {
      return this.getDefaultInsights();
    }

    const BOOST_MODE_THRESHOLD = 30;
    const ECO_MODE_THRESHOLD = 70;
    const IDLE_TIME_THRESHOLD = 5;
    const SHORT_TRIP_DISTANCE = 2;
    const SHORT_TRIP_PERCENTAGE_THRESHOLD = 30;

    const {
      boostModePercentage,
      ecoModePercentage,
      averageIdleTimePerTrip,
      shortTripPercentage,
      totalAllDistance,
      totalAllTrips,
      boostStatus,
      ecoStatus,
      idleStatus,
      shortTripsStatus,
    } = metrics;

    const insights = [];

    // 1. Boost Mode Insight
    const isBoostModeHigh = boostStatus === "above_threshold";
    const isBoostModeGood = boostStatus === "below_threshold";
    insights.push({
      displayname: "Boost Mode Usage",
      type: isBoostModeHigh ? "warning" : isBoostModeGood ? "success" : "info",
      category: "boost_mode",
      title: isBoostModeHigh
        ? "High Boost Mode Usage"
        : isBoostModeGood
        ? "Optimal Boost Mode Usage"
        : "Moderate Boost Mode Usage",
      message: isBoostModeHigh
        ? "Hey! Too much boost mode could impact realised range!"
        : isBoostModeGood
        ? "Great! Boost mode usage is within optimal range"
        : "Boost mode usage is moderate, consider optimizing further",
      details: `${Math.round(
        boostModePercentage
      )}% boost mode usage (ideal is ${BOOST_MODE_THRESHOLD}%)`,
      value: `${Math.round(boostModePercentage)}%`,
      threshold: `Ideal is ${BOOST_MODE_THRESHOLD}%`,
      rawvalue: Math.round(boostModePercentage),
      status: boostStatus,
      priority: isBoostModeHigh ? "high" : isBoostModeGood ? "low" : "medium",
    });

    // 2. Eco Mode Insight
    const isEcoModeGood = ecoStatus === "below_threshold";
    const isEcoModeBad = ecoStatus === "above_threshold";
    
    if (isEcoModeGood) {
      insights.push({
        displayname: "Eco Mode Usage",
        type: "success",
        category: "eco_mode",
        title: "Excellent Eco Driving",
        message: `Hey! Well done - more than ${Math.round(
          ecoModePercentage
        )}% of your drives are Eco`,
        details: `${Math.round(
          ecoModePercentage
        )}% eco mode usage (ideal is ${ECO_MODE_THRESHOLD}%)`,
        value: `${Math.round(ecoModePercentage)}%`,
        threshold: `Ideal is ${ECO_MODE_THRESHOLD}%`,
        rawvalue: Math.round(ecoModePercentage),
        status: ecoStatus,
        priority: "low",
      });
    } else if (ecoStatus === "within_threshold") {
      insights.push({
        displayname: "Eco Mode Usage",
        type: "info",
        category: "eco_mode",
        title: "Eco mode shows promise, a bit more refinement is needed",
        message: "Consider using eco mode more frequently for better efficiency",
        details: `${Math.round(
          ecoModePercentage
        )}% eco mode usage (ideal is ${ECO_MODE_THRESHOLD}%)`,
        value: `${Math.round(ecoModePercentage)}%`,
        threshold: `Ideal is ${ECO_MODE_THRESHOLD}%`,
        rawvalue: Math.round(ecoModePercentage),
        status: ecoStatus,
        priority: "medium",
      });
    } else {
      insights.push({
        displayname: "Eco Mode Usage",
        type: "warning",
        category: "eco_mode",
        title:
          "Insufficient use of Eco mode, could be undermining overall efficiency.",
        message: `Hey! Your ECO mode usage is low - Only ${Math.round(
          ecoModePercentage
        )}% of your drives are Eco`,
        details: `${Math.round(
          ecoModePercentage
        )}% eco mode usage (ideal is ${ECO_MODE_THRESHOLD}%)`,
        value: `${Math.round(ecoModePercentage)}%`,
        threshold: `Ideal is ${ECO_MODE_THRESHOLD}%`,
        rawvalue: Math.round(ecoModePercentage),
        status: ecoStatus,
        priority: "high",
      });
    }

    // 3. Idle Time Insight
    const isIdleTimeHigh = idleStatus === "above_threshold";
    const isIdleTimeGood = idleStatus === "below_threshold";
    const formattedIdleTime = formatEpochToDuration(
      averageIdleTimePerTrip * 60 * 1000
    );
    insights.push({
      displayname: "Idle Time",
      type: isIdleTimeHigh ? "warning" : isIdleTimeGood ? "success" : "info",
      category: "idle_time",
      title: isIdleTimeHigh
        ? "High Idling Time"
        : isIdleTimeGood
        ? "Optimal Idling Time"
        : "Moderate Idling Time",
      message: isIdleTimeHigh
        ? "Hey! Idling time is high – this impacts energy efficiency!"
        : isIdleTimeGood
        ? "Great! Idling time is within optimal range"
        : "Idling time is moderate, consider optimizing further",
      details: `${
        formattedIdleTime || "0 min"
      } average idle time per trip (ideal is ${IDLE_TIME_THRESHOLD} min)`,
      value: formattedIdleTime || "0 min",
      threshold: `Ideal is ${IDLE_TIME_THRESHOLD} min`,
      rawvalue: Math.round(averageIdleTimePerTrip),
      status: idleStatus,
      priority: isIdleTimeHigh ? "medium" : isIdleTimeGood ? "low" : "medium",
    });

    // 4. Short Trips Insight
    const isShortTripsHigh = shortTripsStatus === "above_threshold";
    const isShortTripsGood = shortTripsStatus === "below_threshold";
    const averageTripDistance =
      totalAllTrips > 0 ? totalAllDistance / totalAllTrips : 0;
    insights.push({
      displayname: "Short Trips",
      type: isShortTripsHigh ? "warning" : isShortTripsGood ? "success" : "info",
      category: "short_trips",
      title: isShortTripsHigh
        ? "Frequent Short Trips"
        : isShortTripsGood
        ? "Good Average Trip Distance"
        : "Moderate Short Trips",
      message: isShortTripsHigh
        ? "Hey! Frequent short trips detected – these affect efficiency and battery health."
        : isShortTripsGood
        ? "Trip Distance are well distributed for optimal efficiency"
        : "Some short trips detected, consider optimizing trip patterns",
      details: `${Math.round(
        shortTripPercentage
      )}% short trips (<${SHORT_TRIP_DISTANCE}km), average: ${
        Math.round(averageTripDistance * 100) / 100
      }km (ideal is ${SHORT_TRIP_PERCENTAGE_THRESHOLD}%)`,
      value: `${Math.round(shortTripPercentage)}%`,
      threshold: `Ideal is ${SHORT_TRIP_PERCENTAGE_THRESHOLD}%`,
      rawvalue: Math.round(shortTripPercentage),
      status: shortTripsStatus,
      priority: isShortTripsHigh ? "medium" : isShortTripsGood ? "low" : "medium",
    });

    return insights;
  };
  
  // Helper method to build default date structure with empty arrays
  buildDefaultDateStructure = (starttime, endtime) => {
    const dateStructure = {};
    const startDate = new Date(parseInt(starttime));
    const endDate = new Date(parseInt(endtime));
    const currentDate = new Date(startDate);
  
    while (currentDate <= endDate) {
      const dateKey = this.formatDateToIST(currentDate);
      dateStructure[dateKey] = [];
      currentDate.setDate(currentDate.getDate() + 1);
    }
  
    return dateStructure;
  };

  GetFleetDistanceReportLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive = false
  ) => {
    try {
      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        fleetid,
        recursive
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the fleet");
        return {
          totalvehicles: 0,
          totaltrips: 0,
          daterange: {
            starttime: this.formatDateToIST(new Date(parseInt(starttime))),
            endtime: this.formatDateToIST(new Date(parseInt(endtime))),
          },
          dailydata: {},
        };
      }

      const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);

      const [tripData, regnodata] = await Promise.all([
        this.tripsinsightssvcI.GetTripsByFleet(vinNumbers, starttime, endtime),
        this.fmsAccountSvcI.GetRegno(vinNumbers),
      ]);

      if (!tripData) {
        this.logger.error("Failed to get fleet trips data");
        throw new Error("Failed to get fleet trips data");
      }

      const vinToRegnoMap = {};
      regnodata.forEach(({ vinno, license_plate }) => {
        if (license_plate && license_plate.trim() !== "") {
          vinToRegnoMap[vinno] = license_plate;
        } else {
          vinToRegnoMap[vinno] = `${vinno}`;
        }
      });

      const vehicleInfoMap = {};
      vehicles.forEach((vehicle) => {
        vehicleInfoMap[vehicle.vinno] = vehicle;
      });

      const dailyData = {};

      if (tripData && tripData.length > 0) {
        tripData.forEach((trip) => {
          if (trip.starttime && trip.vin) {
            const tripDate = new Date(parseInt(trip.starttime));
            const dateKey = this.formatDateToIST(tripDate);
            const vehicle = vehicleInfoMap[trip.vin];

            if (vehicle) {
              if (!dailyData[dateKey]) {
                dailyData[dateKey] = {
                  date: dateKey,
                  vehicles: {},
                };
              }

              if (!dailyData[dateKey].vehicles[trip.vin]) {
                dailyData[dateKey].vehicles[trip.vin] = {
                  vinno: trip.vin,
                  regno: vinToRegnoMap[trip.vin] || `${trip.vin}`,
                  vehiclemodel: vehicle.vehiclemodel || "",
                  vehiclevariant: vehicle.vehiclevariant || "",
                  totaldistance: 0,
                  tripcount: 0,
                  trips: [],
                };
              }

              const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
              if (tripDistance > 0) {
                dailyData[dateKey].vehicles[trip.vin].totaldistance +=
                  tripDistance;
              }

              dailyData[dateKey].vehicles[trip.vin].tripcount += 1;

              dailyData[dateKey].vehicles[trip.vin].trips.push({
                starttime: trip.starttime,
                endtime: trip.endtime,
                distance: Math.round(tripDistance * 100) / 100,
                startodo: trip.startodo || 0,
                endodo: trip.endodo || 0,
              });
            }
          }
        });
      }

      Object.keys(dailyData).forEach((dateKey) => {
        Object.keys(dailyData[dateKey].vehicles).forEach((vinno) => {
          const vehicleData = dailyData[dateKey].vehicles[vinno];
          vehicleData.totaldistance =
            Math.round(vehicleData.totaldistance * 100) / 100;
        });
      });

      return {
        totalvehicles: vehicles.length,
        totaltrips: tripData ? tripData.length : 0,
        daterange: {
          starttime: this.formatDateToIST(new Date(parseInt(starttime))),
          endtime: this.formatDateToIST(new Date(parseInt(endtime))),
        },
        dailydata: dailyData,
      };
    } catch (error) {
      this.logger.error("Error in GetFleetDistanceReportLogic:", error);
      throw error;
    }
  };

  GetVehicleDistanceReportLogic = async (
    accountid,
    vinno,
    starttime,
    endtime
  ) => {
    try {
      let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
      if (!rootFleetId) {
        this.logger.info("Root fleet not found for account");
        return {
          totalvehicles: 0,
          totaltrips: 0,
          daterange: {
            starttime: this.formatDateToIST(new Date(parseInt(starttime))),
            endtime: this.formatDateToIST(new Date(parseInt(endtime))),
          },
          dailydata: {},
        };
      }

      let vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        rootFleetId,
        true
      );
      if (!vehicles || vehicles.length === 0) {
        this.logger.info("No vehicles found in the account");
        return {
          totalvehicles: 0,
          totaltrips: 0,
          daterange: {
            starttime: this.formatDateToIST(new Date(parseInt(starttime))),
            endtime: this.formatDateToIST(new Date(parseInt(endtime))),
          },
          dailydata: {},
        };
      }

      let vehicle = vehicles.find((v) => v.vinno === vinno);
      if (!vehicle) {
        this.logger.info("Vehicle not found");
        return {
          totalvehicles: 0,
          totaltrips: 0,
          daterange: {
            starttime: this.formatDateToIST(new Date(parseInt(starttime))),
            endtime: this.formatDateToIST(new Date(parseInt(endtime))),
          },
          dailydata: {},
        };
      }

      const [tripData, regnodata] = await Promise.all([
        this.tripsinsightssvcI.GetTripsByVehicle(
          accountid,
          vinno,
          starttime,
          endtime
        ),
        this.fmsAccountSvcI.GetRegno([vinno]),
      ]);

      if (!tripData) {
        this.logger.error("Failed to get vehicle trips data");
        throw new Error("Failed to get vehicle trips data");
      }

      const vinToRegnoMap = {};
      regnodata.forEach(({ vinno, license_plate }) => {
        if (license_plate && license_plate.trim() !== "") {
          vinToRegnoMap[vinno] = license_plate;
        } else {
          vinToRegnoMap[vinno] = `${vinno}`;
        }
      });

      const dailyData = {};

      if (tripData && tripData.length > 0) {
        tripData.forEach((trip) => {
          if (trip.starttime && trip.vin) {
            const tripDate = new Date(parseInt(trip.starttime));
            const dateKey = this.formatDateToIST(tripDate);

            if (!dailyData[dateKey]) {
              dailyData[dateKey] = {
                date: dateKey,
                vehicles: {},
              };
            }

            if (!dailyData[dateKey].vehicles[trip.vin]) {
              dailyData[dateKey].vehicles[trip.vin] = {
                vinno: trip.vin,
                regno: vinToRegnoMap[trip.vin] || `${trip.vin}`,
                vehiclemodel: vehicle.vehiclemodel || "",
                vehiclevariant: vehicle.vehiclevariant || "",
                totaldistance: 0,
                tripcount: 0,
                trips: [],
              };
            }

            const tripDistance = (trip.endodo || 0) - (trip.startodo || 0);
            if (tripDistance > 0) {
              dailyData[dateKey].vehicles[trip.vin].totaldistance +=
                tripDistance;
            }

            dailyData[dateKey].vehicles[trip.vin].tripcount += 1;

            dailyData[dateKey].vehicles[trip.vin].trips.push({
              starttime: trip.starttime,
              endtime: trip.endtime,
              distance: Math.round(tripDistance * 100) / 100,
              startodo: trip.startodo || 0,
              endodo: trip.endodo || 0,
            });
          }
        });
      }

      Object.keys(dailyData).forEach((dateKey) => {
        Object.keys(dailyData[dateKey].vehicles).forEach((vinno) => {
          const vehicleData = dailyData[dateKey].vehicles[vinno];
          vehicleData.totaldistance =
            Math.round(vehicleData.totaldistance * 100) / 100;
        });
      });

      return {
        totalvehicles: 1,
        totaltrips: tripData ? tripData.length : 0,
        daterange: {
          starttime: this.formatDateToIST(new Date(parseInt(starttime))),
          endtime: this.formatDateToIST(new Date(parseInt(endtime))),
        },
        dailydata: dailyData,
      };
    } catch (error) {
      this.logger.error("Error in GetVehicleDistanceReportLogic:", error);
      throw error;
    }
  };

  calculateMetricDrillDownFromProcessedTrips = (processedTripData, processedAllTripData, starttime, endtime, dateEpochMap = {}) => {
    const BOOST_MODE_THRESHOLD = 30;
    const ECO_MODE_THRESHOLD = 70;
    const IDLE_TIME_THRESHOLD = 5;
    const SHORT_TRIP_DISTANCE = 2;
    const SHORT_TRIP_PERCENTAGE_THRESHOLD = 30;

    const dayWiseData = {};
    const start = new Date(parseInt(starttime));
    const end = new Date(parseInt(endtime));

    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateKey = this.formatDateToIST(currentDate);
      dayWiseData[dateKey] = {
        date: dateKey,
        tripData: [],
        allTripData: [],
      };
      currentDate.setDate(currentDate.getDate() + 1);
    }

    processedTripData.forEach((trip) => {
      if (trip.starttime) {
        const tripDate = new Date(parseInt(trip.starttime));
        const dateKey = this.formatDateToIST(tripDate);
        if (dayWiseData[dateKey]) {
          dayWiseData[dateKey].tripData.push(trip);
        }
      }
    });

    processedAllTripData.forEach((trip) => {
      if (trip.starttime) {
        const tripDate = new Date(parseInt(trip.starttime));
        const dateKey = this.formatDateToIST(tripDate);
        if (dayWiseData[dateKey]) {
          dayWiseData[dateKey].allTripData.push(trip);
        }
      }
    });

    const drillDown = {
      boost_mode: {
        category: "boost_mode",
        title: "Boost Mode Usage - Daily Breakdown",
        threshold: `${BOOST_MODE_THRESHOLD}%`,
        unit: "%",
        dailydata: [],
      },
      eco_mode: {
        category: "eco_mode",
        title: "Eco Mode Usage - Daily Breakdown",
        threshold: `${ECO_MODE_THRESHOLD}%`,
        unit: "%",
        dailydata: [],
      },
      idle_time: {
        category: "idle_time",
        title: "Idle Time - Daily Breakdown",
        threshold: `${IDLE_TIME_THRESHOLD} min`,
        unit: "time",
        dailydata: [],
      },
      short_trips: {
        category: "short_trips",
        title: "Short Trips - Daily Breakdown",
        threshold: `${SHORT_TRIP_PERCENTAGE_THRESHOLD}%`,
        unit: "%",
        dailydata: [],
      },
    };

    const sortedDateKeys = Object.keys(dayWiseData).sort((a, b) => {
      const dateA = DateTime.fromFormat(a, "dd LLL yyyy", {
        zone: "Asia/Kolkata",
      });
      const dateB = DateTime.fromFormat(b, "dd LLL yyyy", {
        zone: "Asia/Kolkata",
      });
      return dateA.toMillis() - dateB.toMillis();
    });

    sortedDateKeys.forEach((dateKey) => {
      const dayData = dayWiseData[dateKey];

      let totalBoostDistance = 0;
      let totalDistance = 0;
      let totalIdleTime = 0;
      let totalBoostSocUsage = 0;
      let totalSocUsage = 0;
      let totalBoostDuration = 0;
      let totalDuration = 0;

      dayData.tripData.forEach((trip) => {
        // Use the raw trip data fields (endodo, startodo, boostdist, idletime)
        let distance = 0;
        let boostDistance = 0;
        let boostSocUsage = 0;
        let tripSocUsage = 0;
        let boostDuration = 0;
        let tripDuration = 0;

        let driveModes = trip.drivemodes || {};
        if(driveModes && driveModes.length > 0) {
          driveModes = JSON.parse(driveModes);
        }
        const modes = driveModes.modes || [];
        if(modes && modes.length > 0) {
          modes.forEach(mode => {
            const modeName = mode.mode?.toLowerCase();
            if (modeName && (modeName === 'eco' || modeName === 'range' || modeName === 'ride' || modeName === 'eccopluse')) {
              distance += mode.distancetravelled || 0;
              tripSocUsage += mode.socconsumed || 0;
              tripDuration += mode.duration || 0;
            } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
              boostDistance += mode.distancetravelled || 0;
              boostSocUsage += mode.socconsumed || 0;
              boostDuration += mode.duration || 0;
              distance += mode.distancetravelled || 0;
              tripSocUsage += mode.socconsumed || 0;
              tripDuration += mode.duration || 0;
            }
          } )
        } else {
          distance = trip.endodo - trip.startodo;
  
          tripDuration = (trip.movingtime || 0) + (trip.idletime || 0);
  
          tripSocUsage = trip.startsoc - trip.endsoc;
          if (tripSocUsage > 0 && trip.boostsocusage != null && trip.boostsocusage > 0) {
            boostSocUsage += (trip.boostsocusage || 0);
          } else if (tripDuration > 0 && trip.boostduration != null && trip.boostduration > 0) {
            // Fallback to duration-based calculation
            boostDuration += (trip.boostduration || 0);
          } else if (distance > 0 && trip.boostdist != null && trip.boostdist > 0) {
            // Fallback to distance-based calculation
            boostDistance += (trip.boostdist || 0);
          }
        }

        if (distance > 0) {
          totalDistance += distance;
          totalBoostDistance += Math.min(boostDistance, distance);
        }
        totalIdleTime += trip.idletime || 0;
        totalBoostSocUsage += boostSocUsage;
        totalSocUsage += tripSocUsage;
        totalBoostDuration += boostDuration;
        totalDuration += tripDuration;
      });

      let shortTrips = 0;
      let totalAllDistance = 0;
      dayData.allTripData.forEach((trip) => {
        let distance = 0;
        let driveModes = trip.drivemodes || {};
        if(driveModes && driveModes.length > 0) {
          driveModes = JSON.parse(driveModes);
        }
        const modes = driveModes.modes || [];
        modes.forEach(mode => {
          const modeName = mode.mode?.toLowerCase();
          if (modeName && (modeName === 'eco' || modeName === 'range' || modeName === 'ride' || modeName === 'eccopluse')) {
            distance += mode.distancetravelled || 0;
          } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
            distance += mode.distancetravelled || 0;
          }
        } )
        if (distance > 0) {
          totalAllDistance += distance;
          if (distance < SHORT_TRIP_DISTANCE) {
            shortTrips++;
          }
        }
      });

      // Calculate aggregate boost mode percentage using SOC-based approach (primary)
      // Fallback to duration-based, then distance-based
      let boostModePercentage = 0;
      if (totalSocUsage > 0 && totalBoostSocUsage > 0) {
        boostModePercentage = (totalBoostSocUsage / totalSocUsage) * 100;
      } else if (totalDuration > 0 && totalBoostDuration > 0) {
        boostModePercentage = (totalBoostDuration / totalDuration) * 100;
      } else if (totalDistance > 0) {
        boostModePercentage = (totalBoostDistance / totalDistance) * 100;
      }
      boostModePercentage = Math.max(0, Math.min(100, boostModePercentage));
      const ecoModePercentage = 100 - Math.round(boostModePercentage);
      const averageIdleTimePerTrip =
        dayData.tripData.length > 0
          ? totalIdleTime / dayData.tripData.length / (1000 * 60)
          : 0;
      const shortTripPercentage =
        dayData.allTripData.length > 0
          ? (shortTrips / dayData.allTripData.length) * 100
          : 0;
      
      // Get epoch range for this date
      const { startepoch, endepoch } = dateEpochMap[dateKey] || { startepoch: null, endepoch: null };

      const boostStatus = this.calculateStatusForMetric(boostModePercentage, "boost_mode");
      const ecoStatus = this.calculateStatusForMetric(ecoModePercentage, "eco_mode");
      const idleStatus = this.calculateStatusForMetric(averageIdleTimePerTrip, "idle_time");
      const shortTripsStatus = this.calculateStatusForMetric(shortTripPercentage, "short_trips");

      drillDown.boost_mode.dailydata.push({
        date: dateKey,
        startepoch,
        endepoch,
        value: `${Math.round(boostModePercentage)}%`,
        rawvalue: Math.round(boostModePercentage),
        status: boostStatus,
        trips: dayData.tripData.length,
        details: `${Math.round(boostModePercentage)}% boost mode usage`,
      });

      drillDown.eco_mode.dailydata.push({
        date: dateKey,
        startepoch,
        endepoch,
        value: `${Math.round(ecoModePercentage)}%`,
        rawvalue: Math.round(ecoModePercentage),
        status: ecoStatus,
        trips: dayData.tripData.length,
        details: `${Math.round(ecoModePercentage)}% eco mode usage`,
      });

      const formattedIdleTime = formatEpochToDuration(
        averageIdleTimePerTrip * 60 * 1000
      );
      drillDown.idle_time.dailydata.push({
        date: dateKey,
        startepoch,
        endepoch,
        value: formattedIdleTime || "0 min",
        rawvalue: Math.round(averageIdleTimePerTrip),
        status: idleStatus,
        trips: dayData.tripData.length,
        details: `${formattedIdleTime || "0 min"} average idle time`,
      });

      drillDown.short_trips.dailydata.push({
        date: dateKey,
        startepoch,
        endepoch,
        value: `${Math.round(shortTripPercentage)}%`,
        rawvalue: Math.round(shortTripPercentage),
        status: shortTripsStatus,
        trips: dayData.allTripData.length,
        details: `${Math.round(shortTripPercentage)}% short trips (<2km)`,
      });
    });

    return drillDown;
  };

  getDefaultInsights = () => {
    return [
      {
        type: "info",
        category: "boost_mode",
        title: "Boost Mode Usage",
        message: "No data available for boost mode analysis",
        details: "Insufficient trip data to analyze boost mode usage",
        value: "0%",
        threshold: "30%",
        rawvalue: 0,
        status: "no_data",
        priority: "low",
      },
      {
        type: "info",
        category: "eco_mode",
        title: "Eco Mode Usage",
        message: "No data available for eco mode analysis",
        details: "Insufficient trip data to analyze eco mode usage",
        value: "0%",
        threshold: "70%",
        rawvalue: 0,
        status: "no_data",
        priority: "low",
      },
      {
        type: "info",
        category: "idle_time",
        title: "Idling Time",
        message: "No data available for idle time analysis",
        details: "Insufficient trip data to analyze idling patterns",
        value: "0 min",
        threshold: "5 min",
        rawvalue: 0,
        status: "no_data",
        priority: "low",
      },
      {
        type: "info",
        category: "short_trips",
        title: "Trip Length Distribution",
        message: "No data available for trip length analysis",
        details: "Insufficient trip data to analyze trip patterns",
        value: "0%",
        threshold: "50%",
        rawvalue: 0,
        status: "no_data",
        priority: "low",
      },
    ];
  };

  getDefaultDrillDown = () => {
    return {
      boost_mode: {
        category: "boost_mode",
        title: "Boost Mode Usage - Daily Breakdown",
        threshold: "30%",
        unit: "%",
        dailydata: [],
      },
      eco_mode: {
        category: "eco_mode",
        title: "Eco Mode Usage - Daily Breakdown",
        threshold: "70%",
        unit: "%",
        dailydata: [],
      },
      idle_time: {
        category: "idle_time",
        title: "Idle Time - Daily Breakdown",
        threshold: "5 min",
        unit: "time",
        dailydata: [],
      },
      short_trips: {
        category: "short_trips",
        title: "Short Trips - Daily Breakdown",
        threshold: "50%",
        unit: "%",
        dailydata: [],
      },
    };
  };

  // helper functions
  calculateActiveVehiclesByDay = (starttime, tripData) => {
    const activeVehicles = {};

    if (tripData && tripData.length > 0) {
      tripData.forEach((trip) => {
        if (trip.starttime) {
          const tripDate = new Date(parseInt(trip.starttime));
          const dateKey = this.formatDateToIST(tripDate);

          if (!activeVehicles[dateKey]) {
            activeVehicles[dateKey] = new Set();
          }
          activeVehicles[dateKey].add(trip.vin);
        }
      });
    }

    const processedActiveVehicles = {};
    Object.keys(activeVehicles).forEach((dateKey) => {
      processedActiveVehicles[dateKey] = activeVehicles[dateKey].size;
    });

    return processedActiveVehicles;
  };

  calculateDrivingModeUsage = (starttime, tripData, vinNumbersLength) => {
    const drivingModeUsage = {};

    if (tripData && tripData.length > 0) {
      tripData.forEach((trip) => {
        if (trip.starttime) {
          const tripDate = new Date(parseInt(trip.starttime));
          const dateKey = this.formatDateToIST(tripDate);

          if (!drivingModeUsage[dateKey]) {
            drivingModeUsage[dateKey] = {
              totaldistance: 0,
              boostdistance: 0,
              ecodistance: 0,
              boostpercentage: 0,
              ecopercentage: 0,
              boostsocusage: 0,
              ecosocusage: 0,
              boostrange: 0,
              ecorange: 0,
              totalsocusage: 0,
            };
          }

          let boostDistance = 0;
          let ecoDistance = 0;
          let boostSocUsage = 0;
          let ecoSocUsage = 0;
          let tripDistance = 0;
          let tripSocUsage = 0;
          let driveModes = trip.drivemodes || {};
          if(driveModes && driveModes.length > 0) {
            driveModes = JSON.parse(driveModes);
          }
          const modes = driveModes.modes || [];
          if(modes && modes.length > 0) {
            modes.forEach(mode => {
              const modeName = mode.mode?.toLowerCase();
              if (modeName && (modeName === 'eco' || modeName === 'range' || modeName === 'ride' || modeName === 'eccopluse')) {
                ecoDistance += mode.distancetravelled || 0;
                ecoSocUsage += mode.socconsumed || 0;
                tripDistance += mode.distancetravelled || 0;
                tripSocUsage += mode.socconsumed || 0;
              } else if (modeName && (modeName === 'boost' || modeName === 'race')) {
                boostDistance += mode.distancetravelled || 0;
                boostSocUsage += mode.socconsumed || 0;
                tripDistance += mode.distancetravelled || 0;
                tripSocUsage += mode.socconsumed || 0;
              }
            } )
          } else {
            tripDistance = trip.endodo - trip.startodo;
    
            tripSocUsage = trip.startsoc - trip.endsoc;
            if (tripSocUsage > 0 && trip.boostsocusage != null && trip.boostsocusage > 0) {
              boostSocUsage += (trip.boostsocusage || 0);
            } else if (tripDistance > 0 && trip.boostdist != null && trip.boostdist > 0) {
              boostDistance += (trip.boostdist || 0);
            }
            ecoDistance = tripDistance - boostDistance;
            ecoSocUsage = tripSocUsage - boostSocUsage;
          }

          if (tripDistance > 0) {
            drivingModeUsage[dateKey].totaldistance += tripDistance;
            drivingModeUsage[dateKey].boostdistance += boostDistance;
            drivingModeUsage[dateKey].ecodistance += ecoDistance;
            drivingModeUsage[dateKey].boostsocusage += boostSocUsage;
            drivingModeUsage[dateKey].ecosocusage += ecoSocUsage;
            drivingModeUsage[dateKey].totalsocusage += tripSocUsage;
          }
        }
      });
    }

    // Calculate range AFTER aggregating all trips for each day
    Object.keys(drivingModeUsage).forEach((dateKey) => {
      const dayData = drivingModeUsage[dateKey];
      
      // Calculate boost range: (total boost distance * 100) / total boost SOC usage
      if (dayData.boostsocusage > 0) {
        dayData.boostrange = (dayData.boostdistance * 100) / dayData.boostsocusage;
      } else {
        dayData.boostrange = 0;
      }
      if (dayData.totalsocusage > 0) {
        dayData.boostsocusage = Math.round((dayData.boostsocusage / dayData.totalsocusage) * 100);
        dayData.ecosocusage = Math.round((dayData.ecosocusage / dayData.totalsocusage) * 100);
      } else {
        dayData.boostsocusage = 0;
        dayData.ecosocusage = 0;
      }
      // Calculate eco range: (total eco distance * 100) / total eco SOC usage
      if (dayData.ecosocusage > 0) {
        dayData.ecorange = (dayData.ecodistance * 100) / dayData.ecosocusage;
      } else {
        dayData.ecorange = 0;
      }
      // Calculate percentages
      if (dayData.totaldistance > 0) {
        const boostPercentage = Math.min(
          100,
          Math.round((dayData.boostdistance / dayData.totaldistance) * 100)
        );
        const ecoPercentage = Math.min(
          100,
          Math.round((dayData.ecodistance / dayData.totaldistance) * 100)
        );

        dayData.boostpercentage = boostPercentage;
        dayData.ecopercentage = Math.min(100 - boostPercentage, ecoPercentage);
      }

      dayData.totaldistance = Math.round(dayData.totaldistance * 100) / 100;
      dayData.boostdistance = Math.round((dayData.boostdistance / vinNumbersLength) * 100) / 100;
      dayData.ecodistance = Math.round((dayData.ecodistance / vinNumbersLength) * 100) / 100;
      dayData.boostrange = Math.round(dayData.boostrange * 100) / 100;
      dayData.ecorange = Math.round(dayData.ecorange * 100) / 100;
    });

    return drivingModeUsage;
  };

  calculateWeekBuckets = (starttime, endtime, tripData) => {
    const weekData = {};
    const startDate = new Date(parseInt(starttime));
    const endDate = new Date(parseInt(endtime));

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayKey = this.formatDateToIST(currentDate);
      weekData[dayKey] = {
        date: dayKey,
        dayofweek: this.getDayOfWeek(currentDate),
        hourBuckets: this.initializeHourBuckets(),
      };
      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (tripData && tripData.length > 0) {
      tripData.forEach((trip) => {
        if (trip.starttime) {
          const tripStartTime = parseInt(trip.starttime);

          if (
            tripStartTime >= parseInt(starttime) &&
            tripStartTime <= parseInt(endtime)
          ) {
            const tripDate = new Date(tripStartTime);
            const dayKey = this.formatDateToIST(tripDate);

            if (weekData[dayKey]) {
              const hour = tripDate.getHours();
              const hourBucketIndex = Math.floor(hour / 2);
              const hourBucketKey = `${hourBucketIndex * 2}-${
                (hourBucketIndex + 1) * 2
              }`;

              const bucket = weekData[dayKey].hourBuckets[hourBucketKey];

              if (!bucket.activeVehicles) {
                bucket.activeVehicles = new Set();
              }
              bucket.activeVehicles.add(trip.vin);
            }
          }
        }
      });
    }

    Object.keys(weekData).forEach((dayKey) => {
      Object.keys(weekData[dayKey].hourBuckets).forEach((hourKey) => {
        const bucket = weekData[dayKey].hourBuckets[hourKey];
        if (bucket.activeVehicles) {
          bucket.activeVehicleCount = bucket.activeVehicles.size;
          delete bucket.activeVehicles;
        } else {
          bucket.activeVehicleCount = 0;
        }
      });
    });

    return weekData;
  };

  initializeHourBuckets = () => {
    const buckets = {};
    for (let i = 0; i < 12; i++) {
      const startHour = i * 2;
      const endHour = (i + 1) * 2;
      const key = `${startHour}-${endHour}`;
      buckets[key] = {
        hourRange: key,
        activeVehicleCount: 0,
      };
    }
    return buckets;
  };

  getDayOfWeek = (gmtDate) => {
    return DateTime.fromJSDate(gmtDate, { zone: "utc" })
      .setZone("Asia/Kolkata")
      .toFormat("cccc");
  };

  getWeekStarttime = (timestamp) => {
    return DateTime.fromMillis(Number(timestamp), {
      zone: "Asia/Kolkata",
      locale: "en-GB",
    })
      .startOf("week")
      .startOf("day")
      .toMillis();
  };

  getWeekEndtime = (timestamp) => {
    return DateTime.fromMillis(Number(timestamp), {
      zone: "Asia/Kolkata",
      locale: "en-GB",
    })
      .endOf("week")
      .endOf("day")
      .toMillis();
  };

  formatDateToIST = (date) => {
    return DateTime.fromJSDate(date, { zone: "utc" })
      .setZone("Asia/Kolkata")
      .toFormat("dd LLL yyyy");
  };
}
