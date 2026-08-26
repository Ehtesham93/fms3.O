import AccountSvcDB from "./accountsvc_db.js";

export default class AccountSvc {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
    this.accountSvcDB = new AccountSvcDB(pgPoolI, logger, config);
  }

  async CreateAccount(account) {
    return await this.accountSvcDB.createAccount(account);
  }

  async GetAllAccounts(platformAccountId, offset, limit, searchtext) {
    return await this.accountSvcDB.getAllAccounts(
      platformAccountId,
      offset,
      limit,
      searchtext
    );
  }

  async GetAccountOverview(accountid) {
    return await this.accountSvcDB.getAccountOverview(accountid);
  }

  async UpdateAccount(accountid, updateFields, updatedby) {
    return await this.accountSvcDB.updateAccount(
      accountid,
      updateFields,
      updatedby
    );
  }

  async DeleteAccount(accountid, deletedby) {
    return await this.accountSvcDB.deleteAccount(accountid, deletedby);
  }

  async GetAccountVehicleCount(accountid) {
    return await this.accountSvcDB.getAccountVehicleCount(accountid);
  }

  async GetAccountInfo(accountid) {
    return await this.accountSvcDB.getAccountInfo(accountid);
  }

  async AddAdminToAccRootFleet(accountid, contact, updatedby) {
    return await this.accountSvcDB.addAdminToAccRootFleet(
      accountid,
      contact,
      updatedby
    );
  }

  async GetAccountUsersInfoWithRoles(accountid) {
    let users = await this.accountSvcDB.getAccountUsersInfoWithRoles(accountid);
    if (!users) {
      return [];
    }
    let usermap = {};
    for (let user of users) {
      if (!usermap[user.userid]) {
        usermap[user.userid] = {
          userid: user.userid,
          displayname: user.displayname,
          email: user.email,
          mobile: user.mobile,
          usertype: user.usertype,
          userinfo: user.userinfo,
          isenabled: user.isenabled,
          isdeleted: user.isdeleted,
          isemailverified: user.isemailverified,
          ismobileverified: user.ismobileverified,
          createdat: user.createdat,
          createdby: user.createdby,
          updatedat: user.updatedat,
          updatedby: user.updatedby,
          roles: [],
        };
      }
      usermap[user.userid].roles.push({
        roleid: user.roleid,
        rolename: user.rolename,
      });
    }
    return Object.values(usermap);
  }

  async RemoveUserFromAccount(accountid, userid, updatedby) {
    return await this.accountSvcDB.removeUserFromAccount(
      accountid,
      userid,
      updatedby
    );
  }

  async GetDefaultAccountPkgs(accountid) {
    let pkgs = await this.accountSvcDB.getDefaultAccountPkgs(accountid);
    if (!pkgs) {
      return [];
    }
    let pkgsMap = {};
    for (let pkg of pkgs) {
      if (!pkgsMap[pkg.pkgid]) {
        pkgsMap[pkg.pkgid] = {
          pkgid: pkg.pkgid,
          pkgname: pkg.pkgname,
          pkgtype: pkg.pkgtype,
          pkginfo: pkg.pkginfo,
          isenabled: pkg.isenabled,
          createdat: pkg.createdat,
          createdby: pkg.createdby,
          updatedat: pkg.updatedat,
          updatedby: pkg.updatedby,
          modules: [],
        };
      }
      if (pkg.moduleid) {
        pkgsMap[pkg.pkgid].modules.push({
          moduleid: pkg.moduleid,
          modulename: pkg.modulename,
          creditspervehicleday: pkg.creditspervehicleday,
        });
      }
    }
    return Object.values(pkgsMap);
  }

  async GetCustomAccountPkgs(accountid) {
    let pkgs = await this.accountSvcDB.getCustomAccountPkgs(accountid);
    if (!pkgs) {
      return [];
    }
    let pkgsMap = {};
    for (let pkg of pkgs) {
      if (!pkgsMap[pkg.pkgid]) {
        pkgsMap[pkg.pkgid] = {
          pkgid: pkg.pkgid,
          pkgname: pkg.pkgname,
          pkgtype: pkg.pkgtype,
          pkginfo: pkg.pkginfo,
          isenabled: pkg.isenabled,
          createdat: pkg.createdat,
          createdby: pkg.createdby,
          updatedat: pkg.updatedat,
          updatedby: pkg.updatedby,
          modules: [],
        };
      }
      if (pkg.moduleid) {
        pkgsMap[pkg.pkgid].modules.push({
          moduleid: pkg.moduleid,
          modulename: pkg.modulename,
          creditspervehicleday: pkg.creditspervehicleday,
        });
      }
    }
    return Object.values(pkgsMap);
  }

  async GetUnassignedCustomPkgs(accountid) {
    return await this.accountSvcDB.getUnassignedCustomPkgs(accountid);
  }

  async AddCustomPkgToAccount(accountid, pkgids, updatedby) {
    return await this.accountSvcDB.addCustomPkgToAccount(
      accountid,
      pkgids,
      updatedby
    );
  }

  async RemoveCustomPkgFromAccount(accountid, pkgid, updatedby) {
    return await this.accountSvcDB.removeCustomPkgFromAccount(
      accountid,
      pkgid,
      updatedby
    );
  }

  async EmailInviteToRootFleet(
    accountid,
    inviteid,
    email,
    invitedby,
    roleids,
    headerReferer
  ) {
    return await this.accountSvcDB.triggerEmailInviteToRootFleet(
      accountid,
      inviteid,
      email,
      invitedby,
      roleids,
      headerReferer
    );
  }

  async MahindrassoInviteToRootFleet(
    accountid,
    inviteid,
    email,
    invitedby,
    roleids,
    headerReferer
  ) {
    return await this.accountSvcDB.triggerMahindrassoInviteToRootFleet(
      accountid,
      inviteid,
      email,
      invitedby,
      roleids,
      headerReferer
    );
  }

  async MobileInviteToRootFleet(
    accountid,
    inviteid,
    mobile,
    invitedby,
    roleids,
    headerReferer
  ) {
    return await this.accountSvcDB.triggerMobileInviteToRootFleet(
      accountid,
      inviteid,
      mobile,
      invitedby,
      roleids,
      headerReferer
    );
  }

  async ResendInvite(accountid, inviteid, invitedby, headerReferer) {
    return await this.accountSvcDB.resendInvite(
      accountid,
      inviteid,
      invitedby,
      headerReferer
    );
  }

  async GetSubscriptionInfo(accountid) {
    return await this.accountSvcDB.getSubscriptionInfo(accountid);
  }

  async GetPkgInfoWithModules(pkgid) {
    let pkgwithmodules = await this.accountSvcDB.getPkgInfoWithModules(pkgid);
    if (!pkgwithmodules) {
      return null;
    }
    let modules = [];
    let pkgcredits = 0;
    for (let pkg of pkgwithmodules) {
      modules.push({
        moduleid: pkg.moduleid,
        modulename: pkg.modulename,
        creditspervehicleday: pkg.creditspervehicleday,
      });
      pkgcredits += Number(pkg.creditspervehicleday);
    }
    return {
      pkgid: pkgwithmodules.pkgid,
      pkgname: pkgwithmodules.pkgname,
      pkgtype: pkgwithmodules.pkgtype,
      pkginfo: pkgwithmodules.pkginfo,
      isenabled: pkgwithmodules.isenabled,
      createdat: pkgwithmodules.createdat,
      createdby: pkgwithmodules.createdby,
      updatedat: pkgwithmodules.updatedat,
      updatedby: pkgwithmodules.updatedby,
      modules: modules,
      pkgcredits: pkgcredits,
    };
  }

  async CreateSubscription(accountid, pkgid, subscriptioninfo, createdby) {
    return await this.accountSvcDB.createSubscription(
      accountid,
      pkgid,
      subscriptioninfo,
      createdby
    );
  }

  async IsVehicleInAccount(accountid, vinno) {
    return await this.accountSvcDB.isVehicleInAccount(accountid, vinno);
  }

  async GetAccountVehicles(accountid) {
    let vehicles = await this.accountSvcDB.getAccountVehicles(accountid);
    if (!vehicles) {
      return [];
    }
    for (let vehicle of vehicles) {
      if (vehicle.subscriptionstate) {
        vehicle.subscription = {
          startsat: vehicle.subscriptionstartsat,
          endsat: vehicle.subscriptionendsat,
          subscriptioninfo: vehicle.subscriptioninfo,
          state: vehicle.subscriptionstate,
          displayablestate: this.getDisplayableSubscriptionState(
            vehicle.subscriptionstate
          ),
        };
        if (vehicle.subscriptionstate === 1) {
          vehicle.subscription.unsubscribeaction = {
            canunsubscribe: true,
            reason: "Vehicle is subscribed. You can unsubscribe it",
          };
        } else if (vehicle.subscriptionstate === 2) {
          vehicle.subscription.unsubscribeaction = {
            canunsubscribe: false,
            reason:
              "Vehicle is staged for unsubscription. You cannot unsubscribe again",
          };
        } else if (vehicle.subscriptionstate === 3) {
          vehicle.subscription.unsubscribeaction = {
            canunsubscribe: false,
            reason:
              "Vehicle is already unsubscribed. You cannot unsubscribe again",
          };
        }
      }
      delete vehicle.subscriptionstartsat;
      delete vehicle.subscriptionendsat;
      delete vehicle.subscriptioninfo;
      delete vehicle.subscriptionstate;
      delete vehicle.subscriptioncreatedat;
      delete vehicle.subscriptioncreatedby;
      delete vehicle.subscriptionupdatedat;
      delete vehicle.subscriptionupdatedby;
    }
    return vehicles;
  }

  getDisplayableSubscriptionState(state) {
    if (state === 1) {
      return "Active";
    } else if (state === 2) {
      return "Staged for Unsubscription";
    } else if (state === 3) {
      return "Unsubscribed";
    }
    return "Unknown";
  }

  async GetSubscribedVehicles(accountid) {
    let allvehicles = await this.GetAccountVehicles(accountid);
    let subscribedvehicles = allvehicles.filter(
      (vehicle) => !!vehicle.subscription && vehicle.subscription.state === 1
    );
    return subscribedvehicles;
  }

  async GetSubscribeableVehicles(accountid) {
    let allvehicles = await this.GetAccountVehicles(accountid);
    let subscribeablevehicles = allvehicles.filter(
      (vehicle) =>
        vehicle.subscription === null ||
        (!!vehicle.subscription && vehicle.subscription.state === 3)
    );
    return subscribeablevehicles;
  }

  async SubscribeVehicles(accountid, vinnos, updatedby) {
    return await this.accountSvcDB.subscribeVehicles(
      accountid,
      vinnos,
      updatedby
    );
  }

  async UnsubscribeVehicle(accountid, vinno, updatedby) {
    return await this.accountSvcDB.unsubscribeVehicle(
      accountid,
      vinno,
      updatedby
    );
  }

  async CheckChangeSubscriptionPackage(accountid, newpkgid) {
    return await this.accountSvcDB.checkChangeSubscriptionPackage(
      accountid,
      newpkgid
    );
  }

  async ChangeSubscriptionPackage(
    accountid,
    newpkgid,
    subscriptioninfo,
    updatedby
  ) {
    return await this.accountSvcDB.changeSubscriptionPackage(
      accountid,
      newpkgid,
      subscriptioninfo,
      updatedby
    );
  }

  async GetSubscriptionHistory(accountid) {
    return await this.accountSvcDB.getSubscriptionHistory(accountid);
  }

  async AddVehicleToAccount(accountid, vehicleinfo, assignedby) {
    return await this.accountSvcDB.addVehicleToAccount(
      accountid,
      vehicleinfo,
      assignedby
    );
  }

  async RemoveVehicleFromAccount(accountid, vinno, removedby) {
    return await this.accountSvcDB.removeVehicleFromAccount(
      accountid,
      vinno,
      removedby
    );
  }

  async GetAssignableVehicles(accountid) {
    return await this.accountSvcDB.getAssignableVehicles(accountid);
  }

  async GetVehicleFleetInfo(vinno, accountid) {
    return await this.accountSvcDB.getVehicleFleetInfo(vinno, accountid);
  }

  async ListPendingAccounts(
    searchtext,
    offset,
    limit,
    orderbyfield,
    orderbydirection,
    download
  ) {
    return await this.accountSvcDB.listPendingAccounts(
      searchtext,
      offset,
      limit,
      orderbyfield,
      orderbydirection,
      download
    );
  }

  async ListDoneAccounts(
    searchtext,
    offset,
    limit,
    orderbyfield,
    orderbydirection,
    download
  ) {
    return await this.accountSvcDB.listDoneAccounts(
      searchtext,
      offset,
      limit,
      orderbyfield,
      orderbydirection,
      download
    );
  }

  async AddReviewDoneAccount(accountData) {
    return await this.accountSvcDB.addReviewDoneAccount(accountData);
  }

  async AddReviewPendingAccount(accountData) {
    return await this.accountSvcDB.addReviewPendingAccount(accountData);
  }

  async GetPendingAccountReviewByAccountName(accountname, vin) {
    return await this.accountSvcDB.getPendingAccountReviewByAccountName(
      accountname,
      vin
    );
  }

  async GetAccountReviewDoneByAccountName(accountname, status) {
    return await this.accountSvcDB.getAccountReviewDoneByAccountName(
      accountname,
      status
    );
  }

  async GetPendingAccountReviewById(accountid) {
    return await this.accountSvcDB.getPendingAccountReviewById(accountid);
  }

  async DeletePendingAccountReviewById(accountid) {
    return await this.accountSvcDB.deletePendingAccountReviewById(accountid);
  }

  async UpdateReviewPendingAccount(accountid, updateFields, updatedby) {
    return await this.accountSvcDB.updateReviewPendingAccount(
      accountid,
      updateFields,
      updatedby
    );
  }

  async DiscardAccountReview(createdBy, taskid) {
    return await this.accountSvcDB.discardAccountReview(createdBy, taskid);
  }

  async ListPendingAccountReviews() {
    return await this.accountSvcDB.listPendingAccountReviews();
  }

  async GetAccountSummary(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    return await this.accountSvcDB.getAccountSummary(
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
  }
  async GetAllAccountUsers(searchtext, offset, limit, download) {
    return await this.accountSvcDB.getAllAccountUsers(
      searchtext,
      offset,
      limit,
      download
    );
  }

  async GetAllLoggedInAccountUsers(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    return await this.accountSvcDB.getAllLoggedInAccountUsers(
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
  }
  async ListAllAccounts() {
    return await this.accountSvcDB.listAllAccounts();
  }

  async AccountsAvailableForTagging(
    platformAccountId,
    vinno,
    searchtext,
    offset,
    limit
  ) {
    return await this.accountSvcDB.accountsAvailableForTagging(
      platformAccountId,
      vinno,
      searchtext,
      offset,
      limit
    );
  }

  async GetAccountCategory() {
    return await this.accountSvcDB.getAccountCategory();
  }
}
