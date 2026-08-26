import FmsSvcDB from "./fmssvc_db.js";
export default class FmsSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.fmsSvcDB = new FmsSvcDB(pgPoolI, logger);
  }

  async GetUserAccounts(userid) {
    return this.fmsSvcDB.getUserAccounts(userid);
  }

  async GetUserAccountFleets(accountid, userid) {
    return this.fmsSvcDB.getUserAccountFleets(accountid, userid);
  }

  async GetAllWebModulesInfo(accountid) {
    return await this.fmsSvcDB.getAllWebModulesInfo(accountid);
  }

  async ListInvitesOfUser(userid) {
    return await this.fmsSvcDB.listInvitesOfUser(userid);
  }

  async ValidateInvite(inviteid, userid) {
    return await this.fmsSvcDB.validateInvite(inviteid, userid);
  }
}
