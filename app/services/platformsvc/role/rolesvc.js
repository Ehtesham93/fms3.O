import RoleSvcDB from "./rolesvc_db.js";

export default class RoleSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.roleSvcDB = new RoleSvcDB(pgPoolI, logger);
  }

  async CreateRole(role) {
    return await this.roleSvcDB.createRole(role);
  }

  async UpdateRole(roleid, accountid, updateFields, updatedby) {
    return await this.roleSvcDB.updateRole(
      roleid,
      accountid,
      updateFields,
      updatedby
    );
  }

  async GetAllRoles(accountid) {
    return await this.roleSvcDB.getAllRoles(accountid);
  }

  async GetRoleInfo(accountid, roleid) {
    return await this.roleSvcDB.getRoleInfo(accountid, roleid);
  }

  async GetAllPlatformModulePerms() {
    return await this.roleSvcDB.getAllPlatformModulePerms();
  }

  async GetRolePerms(accountid, roleid) {
    return await this.roleSvcDB.getRolePermsForAcc(accountid, roleid);
  }

  async UpdateRolePerms(
    accountid,
    roleid,
    permsToAdd,
    permsToRemove,
    updatedby
  ) {
    return await this.roleSvcDB.updateRolePerms(
      accountid,
      roleid,
      permsToAdd,
      permsToRemove,
      updatedby
    );
  }

  async IsRoleAssignedToUsers(roleid) {
    return await this.roleSvcDB.isRoleAssignedToUsers(roleid);
  }

  async DoesRoleHavePermissions(roleid) {
    return await this.roleSvcDB.doesRoleHavePermissions(roleid);
  }

  async DeleteRole(roleid, deletedby) {
    return await this.roleSvcDB.deleteRole(roleid, deletedby);
  }

  async GetRoleHistory(starttime, endtime) {
    return await this.roleSvcDB.getRoleHistory(starttime, endtime);
  }

  async GetRolePermHistory(starttime, endtime) {
    return await this.roleSvcDB.getRolePermHistory(starttime, endtime);
  }

  async GetRolePermHistory(starttime, endtime) {
    return await this.roleSvcDB.getRolePermHistory(starttime, endtime);
  }
}
