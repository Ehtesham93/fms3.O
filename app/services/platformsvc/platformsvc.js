import PlatformSvcDB from "./platformsvc_db.js";
import ModuleSvc from "./module/modulesvc.js";
import RoleSvc from "./role/rolesvc.js";
import PackageSvc from "./package/packagesvc.js";
import PUserSvc from "./user/pusersvc.js";
import AccountSvc from "./account/accountsvc.js";
import ModelSvc from "./model/modelsvc.js";
import MetaSvc from "./meta/metasvc.js";
import SubscriptionSvc from "./subscription/subscriptionsvc.js";
export default class PlatformSvc {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
    this.platformSvcDB = new PlatformSvcDB(pgPoolI, logger);
    this.moduleSvc = new ModuleSvc(pgPoolI, logger);
    this.roleSvc = new RoleSvc(pgPoolI, logger);
    this.packageSvc = new PackageSvc(pgPoolI, logger, config);
    this.pUserSvc = new PUserSvc(pgPoolI, logger);
    this.accountSvc = new AccountSvc(pgPoolI, logger, config);
    this.modelSvc = new ModelSvc(pgPoolI, logger);
    this.metaSvc = new MetaSvc(pgPoolI, logger);
    this.subscriptionSvc = new SubscriptionSvc(pgPoolI, logger, config);
  }

  async GetAllPlatformModulesInfo() {
    return await this.platformSvcDB.getAllPlatformModulesInfo();
  }

  getModuleSvc() {
    return this.moduleSvc;
  }

  getPackageSvc() {
    return this.packageSvc;
  }

  getPUserSvc() {
    return this.pUserSvc;
  }

  getRoleSvc() {
    return this.roleSvc;
  }

  getAccountSvc() {
    return this.accountSvc;
  }

  getModelSvc() {
    return this.modelSvc;
  }

  getMetaSvc() {
    return this.metaSvc;
  }
  getSubscriptionSvc() {
    return this.subscriptionSvc;
  }

  async CreateVehicle(vinno, modelcode, vehicleinfo, mobileno, assignedby) {
    return await this.platformSvcDB.createVehicle(
      vinno,
      modelcode,
      vehicleinfo,
      mobileno,
      assignedby
    );
  }

  async AddVehicleToCustomFleet(accountid, fleetid, vinno, assignedby) {
    return await this.platformSvcDB.addVehicleToCustomFleet(
      accountid,
      fleetid,
      vinno,
      assignedby
    );
  }

  async UpdateVehicleInfo(vinno, updateFields, updatedby) {
    return await this.platformSvcDB.updateVehicleInfo(
      vinno,
      updateFields,
      updatedby
    );
  }

  async CheckVehicleExists(vinno) {
    return await this.platformSvcDB.checkVehicleExists(vinno);
  }

  async CheckModelExists(modelcode) {
    return await this.platformSvcDB.checkModelExists(modelcode);
  }

  async CheckVehicleFleetAssociations(vinno) {
    return await this.platformSvcDB.checkVehicleFleetAssociations(vinno);
  }

  async CheckVehicleTaggedAssociations(vinno) {
    return await this.platformSvcDB.checkVehicleTaggedAssociations(vinno);
  }

  async CheckVehicleSubscriptionAssociations(vinno) {
    return await this.platformSvcDB.checkVehicleSubscriptionAssociations(vinno);
  }

  async CheckVehicleGeofenceRuleAssociations(vinno) {
    return await this.platformSvcDB.checkVehicleGeofenceRuleAssociations(vinno);
  }

  async CheckVehicleTripAssociations(vinno) {
    return await this.platformSvcDB.checkVehicleTripAssociations(vinno);
  }

  async CheckVehicleHistoricalData(vinno) {
    return await this.platformSvcDB.checkVehicleHistoricalData(vinno);
  }

  async DeleteVehicle(vinno, deletedby) {
    return await this.platformSvcDB.deleteVehicle(vinno, deletedby);
  }

  async GetAccountByName(accountname) {
    return await this.platformSvcDB.getAccountByName(accountname);
  }

  async GetAccountById(accountid) {
    return await this.platformSvcDB.getAccountById(accountid);
  }

  async ListVehicles() {
    return await this.platformSvcDB.listVehicles();
  }

  async GetVehicleInfo(vinno) {
    return await this.platformSvcDB.getVehicleInfo(vinno);
  }

  async GetVehicleAccountDetails(vinno) {
    const result = await this.platformSvcDB.getVehicleAccountDetails(vinno);
    if (result.length === 0) {
      return {accounts: [], isassigned: false};
    }
    let isassigned = false;
    result.forEach(item => {
      if (item.isowner) {
        isassigned = true;
      }
      if (item.issubscribed === 1) {
        item.issubscribed = true;
      } else {
        item.issubscribed = false;
      }
    });
    return {accounts: result, isassigned: isassigned};
  }

  async AddToPendingReview(vinno, fields, createdBy) {
    return await this.platformSvcDB.addToPendingReview(
      vinno,
      fields,
      createdBy
    );
  }

  async UpdatePendingReview(vinno, updateFields, createdBy) {
    return await this.platformSvcDB.updatePendingReview(
      vinno,
      updateFields,
      createdBy
    );
  }

  async MoveToDoneReview(vinno, fields, createdBy) {
    return await this.platformSvcDB.moveToDoneReview(vinno, fields, createdBy);
  }

  async CheckVehicleInPending(vinno) {
    return await this.platformSvcDB.checkVehicleInPending(vinno);
  }

  async RemoveFromPendingReview(vinno) {
    return await this.platformSvcDB.removeFromPendingReview(vinno);
  }

  async ListPendingVehicles(searchtext, offset, limit, orderbyfield, orderbydirection, download) {
    return await this.platformSvcDB.listPendingVehicles(searchtext, offset, limit, orderbyfield, orderbydirection, download);
  }

  async ListDoneVehicles(searchtext, offset, limit, orderbyfield, orderbydirection, download) {
    return await this.platformSvcDB.listDoneVehicles(searchtext, offset, limit, orderbyfield, orderbydirection, download);
  }

  async GetAPIKey(platform, environment) {
    return await this.platformSvcDB.getAPIKey(platform, environment);
  }

  async UpdateVehicleCity(vinno, vehiclecity, userid) {
    return await this.platformSvcDB.updateVehicleCity(
      vinno,
      vehiclecity,
      userid
    );
  }
  async UpdateReviewPendingUser(userid, updateFields, updatedby) {
    return await this.platformSvcDB.updateReviewPendingUser(
      userid,
      updateFields,
      updatedby
    );
  }
  async ValidateVehicleFields(fieldsToValidate) {
    return await this.platformSvcDB.validateVehicleFields(fieldsToValidate);
  }

  async GetColourName() {
    return await this.platformSvcDB.getColourName();
  }

  async GetConsolePlatformOverview() {
    return await this.platformSvcDB.getConsolePlatformOverview();
  }

  async GetConsolePlatformOverviewAnalytics() {
    return await this.platformSvcDB.getConsolePlatformOverviewAnalytics();
  }

  async GetConsoleAccountAssignmentHistory(accountid, starttime, endtime) {
    return await this.platformSvcDB.getConsoleAccountAssignmentHistory(
      accountid,
      starttime,
      endtime
    );
  }

  async GetVehicleHistory(starttime, endtime) {
    return await this.platformSvcDB.getVehicleHistory(
      starttime,
      endtime
    );
  }

  async GetConsoleVehicleAssignmentHistory(vinno, starttime, endtime) {
    return await this.platformSvcDB.getConsoleVehicleAssignmentHistory(
      vinno,
      starttime,
      endtime
    );
  }

  async DiscardVehicleReview(createdBy, vin) {
    return await this.platformSvcDB.discardVehicleReview(createdBy, vin);
  }

  async ListPendingVehicleReviews() {
    return await this.platformSvcDB.listPendingVehicleReviews();
  }

  async ListAllVehicles() {
    return await this.platformSvcDB.listAllVehicles();
  }

  async GetVehicles(searchtext, offset, limit) {
    return await this.platformSvcDB.getVehicles(searchtext, offset, limit);
  }

  async SearchVehicles(searchText, offset, limit) {
    if (!searchText || searchText.trim().length === 0) {
      throw new Error("Search text is required");
    }
    if (searchText.trim().length < 2) {
      throw new Error("Search text must be at least 2 characters");
    }
    return await this.platformSvcDB.searchVehicles(searchText, offset, limit);
  }
  async CheckAndCreateCity(cityname) {
    return await this.platformSvcDB.checkAndCreateCity(cityname);
  }
}
