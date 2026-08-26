import ModuleSvcDB from "./modulesvc_db.js";

export default class ModuleSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.moduleSvcDB = new ModuleSvcDB(pgPoolI, logger);
  }

  async CreateModule(module) {
    return await this.moduleSvcDB.createModule(module);
  }

  // async LogModuleHistory(module, updatedby, updatedat, action, previousstate) {
  //   return await this.moduleSvcDB.logModuleHistory(module, updatedby, updatedat, action, previousstate);
  // }

  async LogModulePermHistory(moduleid, permid, action, updatedby, updateFields) {
    return await this.moduleSvcDB.logModulePermHistory(moduleid, permid, action, updatedby, updateFields);
  }

  async GetModuleHistory( starttime, endtime) {
    return await this.moduleSvcDB.getModuleHistory( starttime, endtime);
  }

  async GetModulePermHistory(starttime, endtime) {
    return await this.moduleSvcDB.getModulePermHistory(starttime, endtime);
  }

  async GetAllModulesInfo() {
    return await this.moduleSvcDB.getAllModulesInfo();
  }

  async GetModuleInfo(moduleid) {
    return await this.moduleSvcDB.getModuleInfo(moduleid);
  }

  async GetModulePerms(moduleid) {
    return await this.moduleSvcDB.getModulePerms(moduleid);
  }

  async UpdateModule(moduleid, updateFields, updatedby) {
    return await this.moduleSvcDB.updateModule(
      moduleid,
      updateFields,
      updatedby
    );
  }

  async AddModulePerm(moduleid, permid, isenabled, moduleperminfo, createdby) {
    return await this.moduleSvcDB.addModulePerm(
      moduleid,
      permid,
      isenabled,
      moduleperminfo,
      createdby
    );
  }

  async AddModulePerms(moduleid, permids, createdby) {
    return await this.moduleSvcDB.addModulePerms(moduleid, permids, createdby);
  }

  async UpdateModulePerm(moduleid, permid, updateFields, updatedby) {
    return await this.moduleSvcDB.updateModulePerm(
      moduleid,
      permid,
      updateFields,
      updatedby
    );
  }

  async DeleteModulePerm(moduleid, permid, updatedby) {
    return await this.moduleSvcDB.deleteModulePerm(moduleid, permid, updatedby);
  }

  async IsModuleAssignedToPackage(moduleid) {
    return await this.moduleSvcDB.isModuleAssignedToPackage(moduleid);
  }

  async DeleteModule(moduleid, deletedby) {
    return await this.moduleSvcDB.deleteModule(moduleid, deletedby);
  }

  async IsModuleCodeAvailable(modulecode) {
    let result = await this.moduleSvcDB.isModuleCodeAvailable(modulecode);
    if (result) {
      return {
        modulecode: modulecode,
        isavailable: true,
        message: "Module code is available",
      };
    } else {
      return {
        modulecode: modulecode,
        isavailable: false,
        message: "Module code is not available",
      };
    }
  }
}
