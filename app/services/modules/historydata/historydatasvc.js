import HistoryDataSvcDB from "./historydatasvc_db.js";
import ClickHouseClient from "../../../utils/clickhouse.js";
import { formatEpochToDateTime } from "../../../utils/epochconverter.js";

export default class HistoryDataSvc {
  constructor(pgPoolI, logger, redisSvc) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.clickHouseClient = new ClickHouseClient();
    this.redisSvc = redisSvc;
    this.historyDataSvcDB = new HistoryDataSvcDB(
      pgPoolI,
      this.clickHouseClient,
      logger,
      redisSvc
    );
  }

  async GetGPSHistoryData(accountid, vinnumber, starttime, endtime) {
    return await this.historyDataSvcDB.getGPSHistoryData(
      accountid,
      vinnumber,
      starttime,
      endtime
    );
  }

  async GetCANHistoryData(accountid, vinnumber, starttime, endtime, canparams) {
    return await this.historyDataSvcDB.getCANHistoryData(
      accountid,
      vinnumber,
      starttime,
      endtime,
      canparams
    );
  }

  async GetMergedCANGPSHistoryData(
    accountid,
    vinnumber,
    starttime,
    endtime,
    canparams
  ) {
    return await this.historyDataSvcDB.getMergedCANGPSHistoryData(
      accountid,
      vinnumber,
      starttime,
      endtime,
      canparams
    );
  }

  async GetVehicleLatestCanData(vinnos) {
    try {
      return await this.historyDataSvcDB.getLatestCanData(vinnos);
    } catch (error) {
      this.logger.error("Error fetching latest CAN data:", error);
      throw new Error("Failed to fetch latest CAN data");
    }
  }

  async GetVehicleLatestGpsData(vinnos) {
    try {
      return await this.historyDataSvcDB.getLastestLatLongDataForVins(vinnos);
    } catch (error) {
      this.logger.error("Error fetching latest vehicle data:", error);
      throw new Error("Failed to fetch latest vehicle data");
    }
  }
  async GetVehicleLastConnectedData(value, type) {
    try {
      let vinnos = null;
      let missingRegnos = [];
      let response = [];
      if (type === "vinno") {
        vinnos = value;
      } else if (type === "regno") {
        const result = await this.historyDataSvcDB.getVinNoFromRegNo(value);
        vinnos = result.vinnos;
        missingRegnos = result.missingRegnos;
      } else {
        throw new Error("Invalid type");
      }
      if(vinnos && vinnos.length > 0) {
        const [lastConnectedData, accountDetails] = await Promise.all([
          this.historyDataSvcDB.getVehicleLastConnectedData(vinnos),
          this.historyDataSvcDB.getVehicleAccountDetails(vinnos),
        ]);
        if (lastConnectedData && Object.keys(lastConnectedData).length > 0) {
          for (let vin of vinnos) {
            let connectionstatus = false;
            if(accountDetails && accountDetails.size > 0) {
              const accountDetail = accountDetails.get(vin);
              const account = accountDetail?.account;
              if(account && account?.accountid) {
                let lastConnectedTime = Math.max(lastConnectedData[vin].can.utctime, lastConnectedData[vin].gps.utctime);
                if (Date.now() - lastConnectedTime < 24 * 60 * 60 * 1000) {
                  connectionstatus = true;
                } else {
                  connectionstatus = false;
                }
                let taggedvehicle = null;
                if(accountDetail?.taggedvehicle) {
                  taggedvehicle = accountDetail.taggedvehicle;
                }
                response.push({
                  vinno: vin,
                  accountid: account.accountid,
                  accountname: account.accountname,
                  fleetname: account.fleetname,
                  fleetid: account.fleetid,
                  regno: account.regno,
                  vehiclecity: account.vehicle_city,
                  modelcode: account.modelcode,
                  deliverydate: account.delivered_date,
                  onboardeddate: account.createdat,
                  lastconnectedtime: formatEpochToDateTime(lastConnectedTime),
                  lat: lastConnectedData[vin].gps.lat,
                  lng: lastConnectedData[vin].gps.lng,
                  status: "AVAILABLE",
                  connectionstatus: connectionstatus,
                  subscriptionstatus: account.subscription_status,
                  assignedby: account.assignedby,
                  taggedvehicle: taggedvehicle,
                });
              }else{
                response.push({
                  vinno: vin,
                  accountid: "NA",
                  accountname: "NA",
                  fleetname: "NA",
                  fleetid: "NA",
                  regno: "NA",
                  vehiclecity: "NA",
                  modelcode: "NA",
                  deliverydate: "NA",
                  onboardeddate: "NA",
                  lastconnectedtime: "NA",
                  lat: "NA",
                  lng: "NA",
                  status: "NOT AVAILABLE",
                  connectionstatus: connectionstatus,
                  subscriptionstatus: "NA",
                  assignedby: "NA",
                  taggedvehicle: "NA",
                });
              }
            }else{
              response.push({
                vinno: vin,
                accountid: "NA",
                accountname: "NA",
                fleetname: "NA",
                fleetid: "NA",
                regno: "NA",
                vehiclecity: "NA",
                modelcode: "NA",
                deliverydate: "NA",
                onboardeddate: "NA",
                lastconnectedtime: "NA",
                lat: "NA",
                lng: "NA",
                status: "NOT AVAILABLE",
                connectionstatus: connectionstatus,
                subscriptionstatus: "NA",
                assignedby: "NA",
                taggedvehicle: "NA",
              });
            }
          }
        }
      }
      if(missingRegnos.length > 0) {
        for(let regno of missingRegnos) {
          response.push({
            vinno: "NA",
            accountid: "NA",
            accountname: "NA",
            fleetname: "NA",
            fleetid: "NA",
            regno: regno,
            vehiclecity: "NA",
            modelcode: "NA",
            deliverydate: "NA",
            onboardeddate: "NA",
            lastconnectedtime: "NA",
            lat: "NA",
            lng: "NA",
            status: "NOT AVAILABLE",
            connectionstatus: false,
            subscriptionstatus: "NA",
            assignedby: "NA",
            taggedvehicle: "NA",
          });
        }
      }
        return response;
    } catch (error) {
      this.logger.error("Error fetching vehicle last connected data:", error);
      throw new Error("Failed to fetch vehicle last connected data");
    }
  }
}
