export default class PlatformHdlrImpl {
  constructor(platformSvcI, userSvcI, authSvcI, fmsAccountSvcI, accountSvcI, pUserSvcI, logger) {
    this.platformSvcI = platformSvcI;
    this.userSvcI = userSvcI;
    this.authSvcI = authSvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.accountSvcI = accountSvcI;
    this.pUserSvcI = pUserSvcI;
    this.logger = logger;
  }

  GetConsoleModulesLogic = async (userid) => {
    // get platform module info
    let platformModulesInfo =
      await this.platformSvcI.GetAllPlatformModulesInfo();
    if (!platformModulesInfo || platformModulesInfo.length === 0) {
      this.logger.error("Platform modules info not found");
      throw new Error("Platform modules info not found");
    }
    let modules = [];
    for (let module of platformModulesInfo) {
      if (!module.moduleinfo) {
        module.moduleinfo = {};
      }
      console.log(module.moduleinfo, "-=-=-=-=-=-=-=-==-")
      module.moduleinfo.moduleurl = 'https://localhost:10007/remoteEntry.js'
      modules.push({
        moduleid: module.moduleid,
        moduleinfo: module,
      });
    }

    return {
      userid: userid,
      modules: modules,
    };
  };

  GetConsolePermissionsLogic = async (userid) => {
    // get roles for this userid
    let consolePerms = await this.userSvcI.GetConsolePerms(userid);
    if (!consolePerms || consolePerms.length === 0) {
      this.logger.error("User does not have any console permissions");
      throw new Error("User does not have any console permissions");
    }

    // prepare permissions
    let permissions = this.prepareConsolePermissions(consolePerms);
    return {
      userid: userid,
      permissions: permissions,
    };
  };

  GetAPIKeyLogic = async (platform, environment) => {
    let apiKey = await this.platformSvcI.GetAPIKey(platform, environment);
    if (!apiKey) {
      this.logger.error("API key not found");
      throw new Error("API key not found");
    }
    return apiKey;
  };

  prepareConsolePermissions = (consolePerms) => {
    let showModules = false;
    let showPackages = false;
    let showSubscriptions = false;
    let showRoles = false;
    let showAdministrators = false;
    let showUsers = false;
    let showAccounts = false;
    let showModels = false;

    for (let perm of consolePerms) {
      if (perm.startsWith("consolemgmt.module") || perm == "all.all.all") {
        showModules = true;
      }
      if (perm.startsWith("consolemgmt.package") || perm == "all.all.all") {
        showPackages = true;
      }
      if (
        perm.startsWith("consolemgmt.subscription") ||
        perm == "all.all.all"
      ) {
        showSubscriptions = true;
      }
      if (perm.startsWith("consolemgmt.role") || perm == "all.all.all") {
        showRoles = true;
      }
      if (
        perm.startsWith("consolemgmt.administrator") ||
        perm == "all.all.all"
      ) {
        showAdministrators = true;
      }
      if (perm.startsWith("consolemgmt.user") || perm == "all.all.all") {
        showUsers = true;
      }
      if (perm.startsWith("consolemgmt.account") || perm == "all.all.all") {
        showAccounts = true;
      }
      if (perm.startsWith("consolemgmt.model") || perm == "all.all.all") {
        showModels = true;
      }
    }

    return {
      showModules: showModules,
      showPackages: showPackages,
      showSubscriptions: showSubscriptions,
      showRoles: showRoles,
      showAdministrators: showAdministrators,
      showUsers: showUsers,
      showAccounts: showAccounts,
      showModels: showModels,
    };
  };

  GetConsolePlatformOverviewLogic = async () => {
    let platformOverview = await this.platformSvcI.GetConsolePlatformOverview();
    if (!platformOverview) {
      this.logger.error("Platform overview not found");
      throw new Error("Platform overview not found");
    }
    return platformOverview;
  };
  GetConsolePlatformOverviewAnalyticsLogic = async () => {
    let platformOverview = await this.platformSvcI.GetConsolePlatformOverviewAnalytics();
    if (!platformOverview) {
      this.logger.error("Platform overview not found");
      throw new Error("Platform overview not found");
    }
    return platformOverview;
  };

  GetConsoleAccountAssignmentHistoryLogic = async (accountid, starttime, endtime) => {
    let history = await this.platformSvcI.GetConsoleAccountAssignmentHistory(accountid, starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };
  
  GetConsoleVehicleAssignmentHistoryLogic = async (vinno, starttime, endtime) => {
    let history = await this.platformSvcI.GetConsoleVehicleAssignmentHistory(vinno, starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };


  DiscardReviewLogic = async (createdBy, taskid, type) => {
    try {
      let result=false;
      if(type === "account"){
        result = await this.accountSvcI.DiscardAccountReview(createdBy, taskid);
      } else if(type === "user"){
        result = await this.pUserSvcI.DiscardUserReview(createdBy, taskid);
      } else if(type === "vehicle"){
        result = await this.platformSvcI.DiscardVehicleReview(createdBy, taskid);
      } else {
        throw new Error("Invalid review type");
      }
      if(result){
        return {
          errcode: `${type.toUpperCase()}_REVIEW_DISCARDED`,
          status: `${type.toUpperCase()}_REVIEW_DISCARDED`,
          message: `${type} review discarded successfully`,
        };
      }
      return {
        errcode: `${type.toUpperCase()}_REVIEW_DISCARDED_FAILED`,
        status: `${type.toUpperCase()}_REVIEW_DISCARDED_FAILED`,
        message: `${type} review discarded failed`,
      };
    } catch (error) {
      this.logger.error("DiscardReviewLogic failed", error);
      throw error;
    }
  };
}
