import FmsAccountSvcDB from "./fmsaccountsvc_db.js";

export default class FmsAccountSvc {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.fmsAccountSvcDB = new FmsAccountSvcDB(pgPoolI, logger, config);
  }

  async ListInvitesOfAccount(accountid) {
    return await this.fmsAccountSvcDB.listInvitesOfAccount(accountid);
  }

  async ListInvitesOfFleet(accountid, fleetid, recursive = false) {
    return await this.fmsAccountSvcDB.listInvitesOfFleet(
      accountid,
      fleetid,
      recursive
    );
  }

  async CancelEmailInvite(accountid, inviteid, cancelledby) {
    return await this.fmsAccountSvcDB.cancelEmailInvite(
      accountid,
      inviteid,
      cancelledby
    );
  }

  async SendEmailInvite(
    accountid,
    fleetid,
    roleids,
    inviteid,
    contact,
    invitedby,
    headerReferer
  ) {
    return await this.fmsAccountSvcDB.triggerEmailInvite(
      accountid,
      fleetid,
      roleids,
      inviteid,
      contact,
      invitedby,
      headerReferer
    );
  }

  async SendMahindrassoInvite(
    accountid,
    fleetid,
    roleids,
    inviteid,
    contact,
    invitedby,
    headerReferer
  ) {
    return await this.fmsAccountSvcDB.triggerMahindrassoInvite(
      accountid,
      fleetid,
      roleids,
      inviteid,
      contact,
      invitedby,
      headerReferer
    );
  }

  async ValidateInvite(inviteid, userid) {
    return await this.fmsAccountSvcDB.validateInvite(inviteid, userid);
  }

  async DeleteUserRecords(userid, accountid, fleetid, inviteid, deletedby) {
    return await this.fmsAccountSvcDB.deleteUserRecords(
      userid,
      accountid,
      fleetid,
      inviteid,
      deletedby
    );
  }

  async ResendInvite(accountid, inviteid, invitedby, headerReferer) {
    return await this.fmsAccountSvcDB.resendInvite(
      accountid,
      inviteid,
      invitedby,
      headerReferer
    );
  }

  async GetAllAccountModules(accountid) {
    return await this.fmsAccountSvcDB.getAllAccountModules(accountid);
  }

  async GetUserAccountFleets(accountid, userid) {
    return await this.fmsAccountSvcDB.getUserAccountFleets(accountid, userid);
  }

  // fleet management
  async CreateFleet(accountid, fleetid, parentfleetid, fleetname, createdby) {
    return await this.fmsAccountSvcDB.createFleet(
      accountid,
      fleetid,
      parentfleetid,
      fleetname,
      createdby
    );
  }

  async GetFleetInfo(accountid, fleetid) {
    return await this.fmsAccountSvcDB.getFleetInfo(accountid, fleetid);
  }

  async EditFleet(accountid, fleetid, updateFields, updatedby) {
    return await this.fmsAccountSvcDB.editFleet(
      accountid,
      fleetid,
      updateFields,
      updatedby
    );
  }

  async GetSubFleets(accountid, fleetid, recursive = false) {
    return await this.fmsAccountSvcDB.getSubFleets(
      accountid,
      fleetid,
      recursive
    );
  }

  async GetChildFleets(accountid, fleetid, isrecursive = false) {
    return await this.fmsAccountSvcDB.getChildFleets(
      accountid,
      fleetid,
      isrecursive
    );
  }

  async GetFleetCount(accountid) {
    return await this.fmsAccountSvcDB.getFleetCount(accountid);
  }

  async GetFleetDepthFromRoot(accountid, fleetid) {
    return await this.fmsAccountSvcDB.getFleetDepthFromRoot(accountid, fleetid);
  }

  // role management
  async CreateRole(role) {
    return await this.fmsAccountSvcDB.createRole(role);
  }

  async UpdateRole(accountid, roleid, updateFields, updatedby) {
    return await this.fmsAccountSvcDB.updateRole(
      accountid,
      roleid,
      updateFields,
      updatedby
    );
  }

  async GetAllRoles(accountid) {
    return await this.fmsAccountSvcDB.getAllRoles(accountid);
  }

  async GetRoleInfo(accountid, roleid) {
    return await this.fmsAccountSvcDB.getRoleInfo(accountid, roleid);
  }

  async GetAllPlatformModulePerms() {
    return await this.fmsAccountSvcDB.getAllPlatformModulePerms();
  }

  async GetRolePermsForAccount(accountid, roleid) {
    return await this.fmsAccountSvcDB.getRolePermsForAccount(accountid, roleid);
  }

  async UpdateRolePerms(
    accountid,
    roleid,
    permsToAdd,
    permsToRemove,
    updatedby
  ) {
    return await this.fmsAccountSvcDB.updateRolePerms(
      accountid,
      roleid,
      permsToAdd,
      permsToRemove,
      updatedby
    );
  }

  // vehicle management
  async GetVehicles(
    accountid,
    fleetid,
    recursive = false,
    isforcedfilter = false
  ) {
    return await this.fmsAccountSvcDB.getVehicles(
      accountid,
      fleetid,
      recursive,
      isforcedfilter
    );
  }

  async MoveVehicle(accountid, fromfleetid, tofleetid, vehicleid) {
    return await this.fmsAccountSvcDB.moveVehicle(
      accountid,
      fromfleetid,
      tofleetid,
      vehicleid
    );
  }

  async RemoveVehicle(accountid, fleetid, vehicleid) {
    return await this.fmsAccountSvcDB.removeVehicle(
      accountid,
      fleetid,
      vehicleid
    );
  }

  async ListMoveableFleets(accountid, vehicleid, userid) {
    return await this.fmsAccountSvcDB.listMoveableFleets(
      accountid,
      vehicleid,
      userid
    );
  }

  async GetSubscribedVehiclesFromList(accountid, vehicles) {
    return await this.fmsAccountSvcDB.getSubscribedVehiclesFromList(
      accountid,
      vehicles
    );
  }

  // user management
  async ListUsers(accountid, fleetid, recursive = false) {
    return await this.fmsAccountSvcDB.getFleetUsers(
      accountid,
      fleetid,
      recursive
    );
  }

  async GetAssignableRoles(accountid, fleetid, userid, assignedby) {
    return await this.fmsAccountSvcDB.getAssignableRoles(
      accountid,
      fleetid,
      userid,
      assignedby
    );
  }

  async AssignUserRole(accountid, fleetid, userid, roleids, assignedby) {
    return await this.fmsAccountSvcDB.assignUserRoles(
      accountid,
      fleetid,
      userid,
      roleids,
      assignedby
    );
  }

  async DeassignUserRole(accountid, fleetid, userid, roleid, deassignedby) {
    return await this.fmsAccountSvcDB.deassignUserRole(
      accountid,
      fleetid,
      userid,
      roleid,
      deassignedby
    );
  }

  async GetAllUserRolesOnFleet(accountid, fleetid, userid) {
    return await this.fmsAccountSvcDB.getAllUserRolesOnFleet(
      accountid,
      fleetid,
      userid
    );
  }

  async RemoveUser(accountid, userid, removedby) {
    return await this.fmsAccountSvcDB.removeUser(accountid, userid, removedby);
  }

  // subscription management
  async GetDefaultAccountPkgs(accountid) {
    let pkgs = await this.fmsAccountSvcDB.getDefaultAccountPkgs(accountid);
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
    let pkgs = await this.fmsAccountSvcDB.getCustomAccountPkgs(accountid);
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

  async GetSubscriptionInfo(accountid) {
    return await this.fmsAccountSvcDB.getSubscriptionInfo(accountid);
  }
  async GetSubscriptionHistoryInfo(accountid, starttime, endtime) {
    return await this.fmsAccountSvcDB.getSubscriptionHistoryInfo(accountid, starttime, endtime);
  }

  async UpdateSubscription(accountid, pkgid, subscriptioninfo, updatedby) {
    return await this.fmsAccountSvcDB.updateSubscription(
      accountid,
      pkgid,
      subscriptioninfo,
      updatedby
    );
  }

  async GetSubscriptionHistory(accountid) {
    return await this.fmsAccountSvcDB.getSubscriptionHistory(accountid);
  }

  async GetRootFleetId(accountid) {
    return await this.fmsAccountSvcDB.getRootFleetId(accountid);
  }

  async GetPackageWithModules(pkgid) {
    return await this.fmsAccountSvcDB.getPackageWithModules(pkgid);
  }

  async CheckChangeSubscriptionPackage(accountid, newpkgid) {
    return await this.fmsAccountSvcDB.checkChangeSubscriptionPackage(
      accountid,
      newpkgid
    );
  }

  async GetSubscribedVehicles(accountid) {
    return await this.fmsAccountSvcDB.getSubscribedVehicles(accountid);
  }

  async GetAllVehiclesSourceAccount(vinnos) {
    return await this.fmsAccountSvcDB.getAllVehiclesSourceAccount(vinnos);
  }

  async CreateSubscriptionIntent(accountid, vinnos, userid) {
    return await this.fmsAccountSvcDB.createSubscriptionIntent(
      accountid,
      vinnos,
      userid
    );
  }

  async SubscribeVehicle(accountid, vinnos, userid, intentResult) {
    return await this.fmsAccountSvcDB.subscribeVehicle(
      accountid,
      vinnos,
      userid,
      intentResult
    );
  }

  async UnsubscribeVehicle(accountid, vinnos, userid) {
    return await this.fmsAccountSvcDB.unsubscribeVehicle(
      accountid,
      vinnos,
      userid
    );
  }

  async GetLastestGpsDataForVehicles(vinnos) {
    return await this.fmsAccountSvcDB.getLastestGpsDataForVehicles(vinnos);
  }

  async IsRoleAssignedToUsers(roleid) {
    return await this.fmsAccountSvcDB.isRoleAssignedToUsers(roleid);
  }

  async DoesRoleHavePermissions(roleid) {
    return await this.fmsAccountSvcDB.doesRoleHavePermissions(roleid);
  }

  async DeleteRole(roleid, deletedby) {
    return await this.fmsAccountSvcDB.deleteRole(roleid, deletedby);
  }

  async GetRoleHistory(starttime, endtime) {
    return await this.fmsAccountSvcDB.getRoleHistory(starttime, endtime);
  }

  async DoesFleetHaveVehicles(accountid, fleetid) {
    return await this.fmsAccountSvcDB.doesFleetHaveVehicles(accountid, fleetid);
  }

  async DoesFleetHaveSubfleets(accountid, fleetid) {
    return await this.fmsAccountSvcDB.doesFleetHaveSubfleets(
      accountid,
      fleetid
    );
  }

  async DoesFleetHaveUsers(accountid, fleetid) {
    return await this.fmsAccountSvcDB.doesFleetHaveUsers(accountid, fleetid);
  }

  async DoesFleetHaveConstraints(accountid, fleetid) {
    return await this.fmsAccountSvcDB.doesFleetHaveConstraints(
      accountid,
      fleetid
    );
  }

  async DeleteFleet(accountid, fleetid, deletedby, hasConstraints) {
    return await this.fmsAccountSvcDB.deleteFleet(
      accountid,
      fleetid,
      deletedby,
      hasConstraints
    );
  }

  async IsUserInAccount(accountid, userid) {
    return await this.fmsAccountSvcDB.isUserInAccount(accountid, userid);
  }

  async DeleteUser(accountid, userid, deletedby) {
    return await this.fmsAccountSvcDB.deleteUser(accountid, userid, deletedby);
  }

  async TagVehicle(srcaccountid, dstaccountid, vinnos, allow_retag, taggedby) {
    return await this.fmsAccountSvcDB.tagVehicle(
      srcaccountid,
      dstaccountid,
      vinnos,
      allow_retag,
      taggedby
    );
  }

  async UntagVehicle(srcaccountid, dstaccountid, vinnos, untaggedby) {
    return await this.fmsAccountSvcDB.untagVehicle(
      srcaccountid,
      dstaccountid,
      vinnos,
      untaggedby
    );
  }

  async GetRegno(vinNumbers) {
    return await this.fmsAccountSvcDB.getRegno(vinNumbers);
  }

  async GetChargeStationTypes(accountid) {
    return await this.fmsAccountSvcDB.getChargeStationTypes(accountid);
  }

  async getLatestCanDataForVins(vinNumbers) {
    return await this.fmsAccountSvcDB.getLatestCanDataForVins(vinNumbers);
  }

  async GetAllWebModules() {
    return await this.fmsAccountSvcDB.getAllWebModules();
  }

  async GetAllModulePerms(modules) {
    return await this.fmsAccountSvcDB.getAllModulePerms(modules);
  }

  async GetAccountCredits(accountid) {
    return await this.fmsAccountSvcDB.getAccountCredits(accountid);
  }

  async GetAccountCreditsOverview(accountid, starttime, endtime) {
    return await this.fmsAccountSvcDB.getAccountCreditsOverview(
      accountid,
      starttime,
      endtime
    );
  }

  async GetAccountCreditsHistory(accountid, starttime, endtime) {
    return await this.fmsAccountSvcDB.getAccountCreditsHistory(
      accountid,
      starttime,
      endtime
    );
  }

  async GetAccountVehicleCreditsHistory(accountid, vinnos, starttime, endtime) {
    return await this.fmsAccountSvcDB.getAccountVehicleCreditsHistory(
      accountid,
      vinnos,
      starttime,
      endtime
    );
  }

  async UpdateAccountCredits(accountid, credits, updatedby) {
    return await this.fmsAccountSvcDB.updateAccountCredits(
      accountid,
      credits,
      updatedby
    );
  }

  // helper function
  async GetAccountAndPackageInfo(accountid) {
    return await this.fmsAccountSvcDB.getAccountAndPackageInfo(accountid);
  }

  async GetSharedVehicles(accountid) {
    return await this.fmsAccountSvcDB.getSharedVehicles(accountid);
  }

  async GetVehicleInfo(accountid, vinno) {
    return await this.fmsAccountSvcDB.getVehicleInfo(accountid, vinno);
  }

  async GetSharedAccounts(accountid, vinno) {
    return await this.fmsAccountSvcDB.getSharedAccounts(accountid, vinno);
  }

  async GetVehiclesSharedToMe(accountid) {
    return await this.fmsAccountSvcDB.getVehiclesSharedToMe(accountid);
  }

  async GetAccountInfo(accountid) {
    return await this.fmsAccountSvcDB.getAccountInfo(accountid);
  }

  async GetFleetUserRoleHistory(accountid, starttime, endtime) {
    return await this.fmsAccountSvcDB.getFleetUserRoleHistory(accountid, starttime, endtime);
  }
}


