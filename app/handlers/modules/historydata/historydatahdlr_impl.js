export default class HistoryDataHdlrImpl {
  constructor(historyDataSvcI, logger) {
    this.historyDataSvcI = historyDataSvcI;
    this.logger = logger;
  }

  GetGPSHistoryDataLogic = async (accountid, vinno, starttime, endtime) => {
    // TODO: permission check
    let result = await this.historyDataSvcI.GetGPSHistoryData(
      accountid,
      vinno,
      starttime,
      endtime
    );
    if (!result) {
      this.logger.error("Failed to get GPS history data");
      throw new Error("Failed to get GPS history data");
    }
    return result;
  };

  GetCANHistoryDataLogic = async (
    accountid,
    vinno,
    starttime,
    endtime,
    canparams
  ) => {
    // TODO: permission check
    let result = await this.historyDataSvcI.GetCANHistoryData(
      accountid,
      vinno,
      starttime,
      endtime,
      canparams
    );
    if (!result) {
      this.logger.error("Failed to get CAN history data");
      throw new Error("Failed to get CAN history data");
    }
    return result;
  };

  GetMergedCANGPSHistoryDataLogic = async (
    accountid,
    vinno,
    starttime,
    endtime,
    canparams
  ) => {
    // TODO: permission check
    let result = await this.historyDataSvcI.GetMergedCANGPSHistoryData(
      accountid,
      vinno,
      starttime,
      endtime,
      canparams
    );
    if (!result) {
      this.logger.error("Failed to get merged CAN+GPS history data");
      throw new Error("Failed to get merged CAN+GPS history data");
    }
    return result;
  };

  GetVehicleLatestDataLogic = async (vinnos) => {
    if (!vinnos || vinnos.length === 0) {
      return {};
    }

    const BATCH_SIZE = 100;
    const chunks = [];

    for (let i = 0; i < vinnos.length; i += BATCH_SIZE) {
      chunks.push(vinnos.slice(i, i + BATCH_SIZE));
    }

    const chunkPromises = chunks.map(async (chunk) => {
      const [gpsChunk, canChunk] = await Promise.allSettled([
        this.historyDataSvcI.GetVehicleLatestGpsData(chunk),
        this.historyDataSvcI.GetVehicleLatestCanData(chunk),
      ]);
      return { gps: gpsChunk, can: canChunk };
    });

    const results = await Promise.allSettled(chunkPromises);

    let mergedGpsData = {};
    let mergedCanData = {};

    results.forEach(({ status, value }) => {
      if (status === "fulfilled") {
        mergedCanData = { ...mergedCanData, ...value.can.value };
        mergedGpsData = { ...mergedGpsData, ...value.gps.value };
      } else {
        this.logger.error("Error processing chunk:", value.reason);
      }
    });

    return {
      gpsdata: mergedGpsData,
      candata: mergedCanData,
    };
  };
}
