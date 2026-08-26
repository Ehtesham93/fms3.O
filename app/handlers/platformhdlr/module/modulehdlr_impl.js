import { v4 as uuidv4 } from "uuid";

export default class ModuleHdlrImpl {
  constructor(moduleSvcI, userSvcI, logger) {
    this.moduleSvcI = moduleSvcI;
    this.userSvcI = userSvcI;
    this.logger = logger;
  }

  GetModuleTypesLogic = async () => {
    return {
      moduleTypes: ["platform", "api", "web"],
    };
  };

  CreateModuleLogic = async (
    modulename,
    moduletype,
    modulecode,
    creditspervehicleday,
    createdby
  ) => {
    let moduleid = uuidv4();
    let moduleinfo = {};
    let isenabled = false;
    let module = {
      moduleid: moduleid,
      modulename: modulename,
      moduletype: moduletype,
      modulecode: modulecode,
      moduleinfo: moduleinfo,
      creditspervehicleday: Number(creditspervehicleday),
      isenabled: isenabled,
      createdby: createdby,
    };
    let res = await this.moduleSvcI.CreateModule(module);
    if (!res) {
      this.logger.error("Failed to create module");
      throw new Error("Failed to create module");
    } else if (res.errcode === "MODULE_CODE_ALREADY_EXISTS") {
      throw res;
    }
    
    return {
      moduleid: moduleid,
      module: module,
    };
  };

  ListModulesLogic = async () => {
    let modules = await this.moduleSvcI.GetAllModulesInfo();
    if (!modules) {
      modules = [];
    }
    // modules = modules.filter(module => module.modulecode !== "consolemgmt");    // TODO: should filter out platform modules
    modules = modules.map((module) => {
      module.creditspervehicleday = Number(module.creditspervehicleday);
      return module;
    });
    return {
      modules: modules,
    };
  };

  GetModuleLogic = async (moduleid) => {
    let module = await this.moduleSvcI.GetModuleInfo(moduleid);
    if (!module) {
      this.logger.error("Module not found");
      throw new Error("Module not found");
    }
    module.creditspervehicleday = Number(module.creditspervehicleday);

    // get permissions for this module
    let permissions = await this.moduleSvcI.GetModulePerms(moduleid);
    if (!permissions) {
      permissions = [];
    }

    return {
      module: module,
      permissions: permissions,
    };
  };

  UpdateModuleLogic = async (moduleid, updateFields, updatedby) => {
    const processedFields = {};

    if (updateFields.hasOwnProperty("creditspervehicleday")) {
      processedFields.creditspervehicleday = Number(
        updateFields.creditspervehicleday
      );
    }

    if (updateFields.hasOwnProperty("moduleinfo")) {
      processedFields.moduleinfo = updateFields.moduleinfo || {};
    }

    if (updateFields.hasOwnProperty("isenabled")) {
      processedFields.isenabled = !!updateFields.isenabled;
    }

    if (updateFields.hasOwnProperty("modulename")) {
      processedFields.modulename = updateFields.modulename;
    }

    if (updateFields.hasOwnProperty("moduletype")) {
      processedFields.moduletype = updateFields.moduletype;
    }

    if (updateFields.hasOwnProperty("priority")) {
      processedFields.priority = updateFields.priority;
    }

    let res = await this.moduleSvcI.UpdateModule(
      moduleid,
      processedFields,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to update module");
      throw new Error("Failed to update module");
    }

    return {
      moduleid: moduleid,
    };
  };

  AddModulePermLogic = async (
    moduleid,
    permid,
    isenabled,
    moduleperminfo,
    createdby
  ) => {
    if (!moduleperminfo) {
      moduleperminfo = {};
    }
    let res = await this.moduleSvcI.AddModulePerm(
      moduleid,
      permid,
      isenabled,
      moduleperminfo,
      createdby
    );
    if (!res) {
      this.logger.error("Failed to add module permission");
      throw new Error("Failed to add module permission");
    }
    return {
      moduleid: moduleid,
      permid: permid,
      isenabled: isenabled,
      moduleperminfo: moduleperminfo,
      createdby: createdby,
    };
  };

  AddModulePermsLogic = async (moduleid, permids, createdby) => {
    let res = await this.moduleSvcI.AddModulePerms(
      moduleid,
      permids,
      createdby
    );
    if (!res) {
      this.logger.error("Failed to add module permissions");
      throw new Error("Failed to add module permissions");
    }
    return {
      moduleid: moduleid,
      permids: permids,
      createdby: createdby,
    };
  };

  UpdateModulePermLogic = async (moduleid, permid, updateFields, updatedby) => {
    const allowedFields = ["isenabled", "modperminfo"];
    const filteredFields = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        filteredFields[key] = key === "isenabled" ? !!value : value || {};
      }
    }

    if (Object.keys(filteredFields).length === 0) {
      throw new Error("No valid fields provided for update");
    }

    const res = await this.moduleSvcI.UpdateModulePerm(
      moduleid,
      permid,
      filteredFields,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to update module permission");
      throw new Error("Failed to update module permission");
    }
 
    // TOOD: why are we returning the updatedby name?
    const updatedbyname = await this.userSvcI.getUserName(updatedby);

    return {
      moduleid,
      permid,
      isenabled: filteredFields.isenabled,
      moduleperminfo: filteredFields.modperminfo,
      updatedby: updatedbyname,
    };
  };

  DeleteModulePermLogic = async (moduleid, permid, updatedby) => {
    let res = await this.moduleSvcI.DeleteModulePerm(moduleid, permid, updatedby);

    if (!res) {
      this.logger.error("Failed to delete module permission");
      throw new Error("Failed to delete module permission");
    }
   
    return {
      moduleid: moduleid,
      permid: permid,
    };
  };

  DeleteModuleLogic = async (moduleid, deletedby) => {
    let module = await this.moduleSvcI.GetModuleInfo(moduleid);
    if (!module) {
      throw new Error("Module not found");
    }

    let isAssignedToPackage = await this.moduleSvcI.IsModuleAssignedToPackage(
      moduleid
    );
    if (isAssignedToPackage) {
      throw {
        errcode: "MODULE_ASSIGNED_TO_PACKAGES",
        message: "Cannot delete module. It is assigned to one or more packages",
      };
    }
    let res = await this.moduleSvcI.DeleteModule(moduleid, deletedby);
    if (!res) {
      this.logger.error("Failed to delete module");
      throw new Error("Failed to delete module");
    }
  };

  GetModuleHistoryLogic = async ( starttime, endtime) => {
    let history = await this.moduleSvcI.GetModuleHistory(starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };

  GetModulePermHistoryLogic = async (starttime, endtime) => {
    let history = await this.moduleSvcI.GetModulePermHistory(starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };
  IsModuleCodeAvailableLogic = async (modulecode) => {
    return await this.moduleSvcI.IsModuleCodeAvailable(modulecode);
  };
}
