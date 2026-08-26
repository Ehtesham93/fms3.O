import FmsAccountHdlrImpl from "../../handlers/modules/fmsaccount/fmsaccounthdlr_impl.js";

export default class PermissionSvc {
  constructor(fmsAccountSvcI, userSvcI, logger) {
    this.fmsAccountHdlrImpl = new FmsAccountHdlrImpl(
      fmsAccountSvcI,
      userSvcI,
      logger
    );
  }

  async GetUserFleetPermissions(userid, accountid, fleetid) {
    try {
      if (!fleetid) {
        fleetid = await this.fmsAccountHdlrImpl.fmsAccountSvcI.GetRootFleetId(
          accountid
        );
        if (!fleetid) {
          return [];
        }
      }

      const fleetIdRegex =
        /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
      if (!fleetIdRegex.test(fleetid)) {
        throw {
          errcode: "INVALID_FLEET_ID_FORMAT",
          errdata: {},
          message: "Fleet ID must be a valid UUID format",
        };
      }

      const result = await this.fmsAccountHdlrImpl.GetMyFleetPermissionsLogic(
        userid,
        accountid,
        fleetid
      );

      if (!result) {
        return [];
      }
      return result?.permissions || [];
    } catch (error) {
      if (
        error.errcode === "FLEET_NOT_FOUND" ||
        error.errcode === "INVALID_FLEET_ID_FORMAT" ||
        error.errcode === "ROOT_FLEET_NOT_FOUND"
      ) {
        throw error;
      }
      return [];
    }
  }
}
