export default class LivetrackingsvcDB {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
  }

  async getVehicles(accountid, fleetid, recursive) {
    try {
      let query;
      if (recursive) {
        query = `
            WITH RECURSIVE fleet_hierarchy AS (
              SELECT ft.accountid, ft.fleetid, ft.name
              FROM fleet_tree ft
              WHERE ft.accountid = $1 AND ft.fleetid = $2 AND ft.isdeleted = false

              UNION ALL

              SELECT ft.accountid, ft.fleetid, ft.name
              FROM fleet_tree ft
              JOIN fleet_hierarchy fh ON ft.accountid = fh.accountid AND ft.pfleetid = fh.fleetid
              WHERE ft.isdeleted = false
            )
            SELECT fv.accountid, fv.fleetid, fv.vinno, COALESCE(v.license_plate, v.vinno) as regno, fv.isowner, fv.accvininfo, 
                   fv.assignedat, fv.updatedat, u1.displayname as assignedby, u2.displayname as updatedby,
                   vm.modelvariant as modelvariant, vm.modelname as modelname, vm.modeldisplayname, v.modelcode, v.vehicleinfo, af.isroot
            FROM fleet_vehicle fv
            JOIN vehicle v ON fv.vinno = v.vinno
            JOIN users u1 ON fv.assignedby = u1.userid
            JOIN users u2 ON fv.updatedby = u2.userid
            JOIN account_fleet af ON fv.accountid = af.accountid AND fv.fleetid = af.fleetid
            JOIN fleet_hierarchy fh ON fv.accountid = fh.accountid AND fv.fleetid = fh.fleetid
            JOIN vehicle_model vm ON v.modelcode = vm.modelcode
            ORDER BY fv.assignedat DESC
          `;
      } else {
        query = `
            SELECT fv.accountid, fv.fleetid, fv.vinno, COALESCE(v.license_plate, v.vinno) as regno, fv.isowner, fv.accvininfo, 
                   fv.assignedat, fv.updatedat, u1.displayname as assignedby, u2.displayname as updatedby,
                   vm.modelvariant as modelvariant, vm.modelname as modelname, vm.modeldisplayname, v.modelcode, v.vehicleinfo, af.isroot
            FROM fleet_vehicle fv
            JOIN vehicle v ON fv.vinno = v.vinno
            JOIN users u1 ON fv.assignedby = u1.userid
            JOIN users u2 ON fv.updatedby = u2.userid
            JOIN account_fleet af ON fv.accountid = af.accountid AND fv.fleetid = af.fleetid
            JOIN vehicle_model vm ON v.modelcode = vm.modelcode
            WHERE fv.accountid = $1 AND fv.fleetid = $2
            ORDER BY fv.assignedat DESC
          `;
      }

      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      if (result.rowCount === 0) {
        return [];
      }
      const allVehicles = result.rows;

      const shouldFilterSubscribed =
        this.config?.fmsFeatures?.enableSubscribedVehiclesFilter || false;

      if (!shouldFilterSubscribed) {
        return allVehicles;
      }

      const vinNumbers = allVehicles.map((vehicle) => vehicle.vinno);

      const subscribedQuery = `
        SELECT vinno FROM account_vehicle_subscription 
        WHERE accountid = $1 AND vinno = ANY($2) AND state = 1
      `;
      const subscribedResult = await this.pgPoolI.Query(subscribedQuery, [
        accountid,
        vinNumbers,
      ]);

      if (subscribedResult.rowCount === 0) {
        return [];
      }

      const subscribedVins = new Set(
        subscribedResult.rows.map((row) => row.vinno)
      );

      const subscribedVehicles = allVehicles.filter((vehicle) =>
        subscribedVins.has(vehicle.vinno)
      );

      return subscribedVehicles;
    } catch (error) {
      throw new Error("Unable to retrieve vehicle information");
    }
  }

  async checkVehicleExists(accountid, vinno) {
    let query = `
      SELECT fv.vinno 
      FROM fleet_vehicle fv 
      WHERE fv.accountid = $1 AND fv.vinno = $2;
    `;
    let result = await this.pgPoolI.Query(query, [accountid, vinno]);
    return result.rowCount > 0;
  }

  async getVehicleInfo(accountid, vinno) {
    // TODO: check if vinno is valid and with in the account and fleet

    let query = `
      SELECT v.vinno, vm.modelvariant, vm.modelname, vm.modeldisplayname, v.modelcode, v.vehicleinfo, v.mobile, COALESCE(v.license_plate, v.vinno) as license_plate, v.color, v.vehicle_city, v.dealer, v.delivered, v.delivered_date, v.data_freq, v.tgu_model, v.tgu_sw_version, v.tgu_phone_no, v.tgu_imei_no, v.createdat, u1.displayname as createdby, v.updatedat, u2.displayname as updatedby
      FROM vehicle v
      JOIN users u1 ON v.createdby = u1.userid
      JOIN users u2 ON v.updatedby = u2.userid
      JOIN vehicle_model vm ON v.modelcode = vm.modelcode
      WHERE v.vinno = $1;
    `;
    let result = await this.pgPoolI.Query(query, [vinno]);
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0];
  }
}
