import { v4 as uuidv4 } from "uuid";

export default class PlatformHdlrImpl {
  constructor(platformSvcI, logger) {
    this.platformSvcI = platformSvcI;
    this.logger = logger;
  }

  CreatePackageTypeLogic = async (pkgtype, createdby) => {
    let res = await this.platformSvcI.CreatePackageType(pkgtype, createdby);
    if (!res) {
      this.logger.error("Failed to create package type");
      throw new Error("Failed to create package type");
    }
    return {
      pkgtype: pkgtype,
    };
  };

  GetPackageTypesLogic = async () => {
    let res = await this.platformSvcI.GetAllPackageTypes();
    if (!res) {
      res = [];
    }
    return {
      pkgtypes: res,
    };
  };

  CreatePkgLogic = async (pkgname, pkgtype, pkginfo, isenabled, createdby) => {
    let pkgid = uuidv4();
    let pkg = {
      pkgid: pkgid,
      pkgname: pkgname,
      pkgtype: pkgtype,
      pkginfo: pkginfo,
      isenabled: isenabled,
    };
    let res = await this.platformSvcI.CreatePackage(pkg, createdby);
    if (!res) {
      this.logger.error("Failed to create package");
      throw new Error("Failed to create package");
    }
    return {
      pkgid: pkgid,
      pkg: pkg,
    };
  };

  UpdatePackageLogic = async (pkgid, updateFields, updatedby) => {
    const allowedFields = ["pkgname", "pkginfo", "isenabled"];
    const filteredFields = {};

    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        filteredFields[key] = key === "isenabled" ? !!value : value || {};
      }
    }
    if (Object.keys(filteredFields).length === 0) {
      throw new Error("No valid fields provided for update");
    }
    const res = await this.platformSvcI.UpdatePackage(
      pkgid,
      filteredFields,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to update package");
      throw new Error("Failed to update package");    
    }
    return {
      pkgid: pkgid,
      pkg: filteredFields,
    };
  };

  ListPackagesLogic = async () => {
    let pkgs = await this.platformSvcI.GetAllPackages();
    if (!pkgs) {
      pkgs = [];
    }
    return { pkgs: pkgs };
  };

  GetPkgInfoLogic = async (pkgid) => {
    let pkg = await this.platformSvcI.GetPkgInfo(pkgid);
    if (!pkg) {
      this.logger.error("Package not found");
      throw new Error("Package not found");
    }

    // get all modules
    let allModules = await this.platformSvcI.GetAllModulesInfo();
    if (!allModules) {
      allModules = [];
    }

    // get modules assigned to this package
    let modules = await this.platformSvcI.GetPkgModules(pkgid);
    if (!modules) {
      modules = [];
    }
    let pkgcost = 0;
    for (let module of allModules) {
      if (modules.includes(module.moduleid)) {
        module.isassigned = true;
        pkgcost += Number(module.creditspervehicleday);
      } else {
        module.isassigned = false;
      }
    }

    pkg.creditspervehicleday = pkgcost;

    return { pkg: pkg, modules: allModules };
  };

  UpdatePkgModulesLogic = async (
    pkgid,
    selectedmodules,
    deselectedmodules,
    updatedby
  ) => {
    const success = await this.platformSvcI.UpdatePkgModules(
      pkgid,
      selectedmodules,
      deselectedmodules,
      updatedby
    );
    if (!success) {
      this.logger.error("Failed to update package modules");
      throw new Error("Failed to update package modules");
    }
    return {
      pkgid,
      selectedmodules,
      deselectedmodules,
      updatedby,
    };
  };

  DeletePackageLogic = async (pkgid, deletedby) => {
    let pkg = await this.platformSvcI.GetPkgInfo(pkgid);
    if (!pkg) {
      this.logger.error("Package not found");
      throw {
        errcode: "INPUT_ERROR",
        errdata: "Package not found",
        message: "Package not found",
      };
    }

    let isAssignedToAccount =
      await this.platformSvcI.IsPackageAssignedToAccount(pkgid);
    if (isAssignedToAccount) {
      throw {
        errcode: "PACKAGE_IN_USE",
        errdata: "Package assigned to account",
        message:
          "Cannot delete package. It is currently assigned to one or more accounts.",
      };
    }

    let hasModules = await this.platformSvcI.DoesPackageHaveModules(pkgid);
    if (hasModules) {
      throw {
        errcode: "PACKAGE_HAS_MODULES",
        errdata: "Package has modules",
        message: "Cannot delete package. It has modules assigned.",
      };
    }

    let hasHistory = await this.platformSvcI.DoesPackageHaveHistory(pkgid);
    if (hasHistory) {
      throw {
        errcode: "PACKAGE_HAS_HISTORY",
        errdata: "Package has historical records",
        message:
          "Cannot delete package. It has historical subscription records",
      };
    }

    let res = await this.platformSvcI.DeletePackage(pkgid, deletedby);
    if (!res) {
      this.logger.error("Failed to delete package");
      throw new Error("Failed to delete package");
    }

    return {
      pkgid: pkgid,
      pkgname: pkg.pkgname,
      deletedat: new Date(),
      deletedby: deletedby,
    };
  };


  GetPackageHistoryLogic = async (starttime, endtime) => {
    let history = await this.platformSvcI.GetPackageHistory(starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };

  GetPackageModHistoryLogic = async (starttime, endtime) => {
    let history = await this.platformSvcI.GetPackageModHistory(starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };
}
