import PackageSvcDB from "./packagesvc_db.js";

export default class PackageSvc {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
    this.packageSvcDB = new PackageSvcDB(pgPoolI, logger, config);
  }

  async CreatePackageType(pkgtype, createdby) {
    return await this.packageSvcDB.createPackageType(pkgtype, createdby);
  }

  async GetAllPackageTypes() {
    return await this.packageSvcDB.getAllPackageTypes();
  }

  async CreatePackage(pkg, createdby) {
    return await this.packageSvcDB.createPackage(pkg, createdby);
  }

  async GetPackageHistory(starttime, endtime){
    return await this.packageSvcDB.getPackageHistory(starttime, endtime);
  }

  async GetPackageModHistory(starttime, endtime){
    return await this.packageSvcDB.getPackageModHistory(starttime, endtime);
  }

  async UpdatePackage(pkgid, updateFields, updatedby) {
    return await this.packageSvcDB.updatePackage(
      pkgid,
      updateFields,
      updatedby
    );
  }

  async GetAllPackages() {
    return await this.packageSvcDB.getAllPackages();
  }

  async GetPkgInfo(pkgid) {
    return await this.packageSvcDB.getPkgInfo(pkgid);
  }

  async LogPackageHistory(pkg, updatedby, updatedat, action, previousstate) {
    return await this.packageSvcDB.logPackageHistory(pkg, updatedby, updatedat, action, previousstate);
  }

  async LogPackageModHistory(pkgid, moduleid, action, updatedby, updatedat) {
    return await this.packageSvcDB.logPackageModHistory(pkgid, moduleid, action, updatedby, updatedat);
  }

  async GetPkgModules(pkgid) {
    return await this.packageSvcDB.getPkgModules(pkgid);
  }

  async UpdatePkgModules(pkgid, selectedmodules, deselectedmodules, updatedby) {
    return await this.packageSvcDB.updatePkgModules(
      pkgid,
      selectedmodules,
      deselectedmodules,
      updatedby
    );
  }

  async GetAllModulesInfo() {
    return await this.packageSvcDB.getAllModulesInfo();
  }

  async IsPackageAssignedToAccount(pkgid) {
    return await this.packageSvcDB.isPackageAssignedToAccount(pkgid);
  }

  async DoesPackageHaveModules(pkgid) {
    return await this.packageSvcDB.doesPackageHaveModules(pkgid);
  }

  async DoesPackageHaveHistory(pkgid) {
    return await this.packageSvcDB.doesPackageHaveHistory(pkgid);
  }

  async DeletePackage(pkgid, deletedby) {
    return await this.packageSvcDB.deletePackage(pkgid, deletedby);
  }
}
