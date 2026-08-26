import { v4 as uuidv4 } from "uuid";

export default class RoleHdlrImpl {
  constructor(roleSvcI, logger) {
    this.roleSvcI = roleSvcI;
    this.logger = logger;
  }

  CreateRoleLogic = async (rolename, roletype, isenabled, createdby) => {
    let roleid = uuidv4();
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let role = {
      accountid: accountid,
      roleid: roleid,
      rolename: rolename,
      roletype: roletype,
      isenabled: !!isenabled,
      createdby: createdby,
    };
    let res = await this.roleSvcI.CreateRole(role);
    if (!res) {
      this.logger.error("Failed to create role");
      throw new Error("Failed to create role");
    }
    delete role.accountid;

    return {
      roleid: roleid,
      role: role,
    };
  };

  UpdateRoleLogic = async (roleid, updateFields, updatedby) => {
    let allowedFields = ["rolename", "roletype", "isenabled"];
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let fieldsToUpdate = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        fieldsToUpdate[key] = key === "isenabled" ? !!value : value;
      }
    }
    if (Object.keys(fieldsToUpdate).length === 0) {
      throw new Error("No valid fields provided for update");
    }

    let res = await this.roleSvcI.UpdateRole(
      roleid,
      accountid,
      fieldsToUpdate,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to update role");
      throw new Error("Failed to update role");
    }
    return {
      roleid,
      role: {
        roleid,
        ...fieldsToUpdate,
        updatedby,
      },
    };
  };

  ListRolesLogic = async () => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let roles = await this.roleSvcI.GetAllRoles(accountid);
    if (!roles) {
      roles = [];
    }
    return {
      roles: roles,
    };
  };

  GetRoleInfoLogic = async (roleid) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    let roleInfo = await this.roleSvcI.GetRoleInfo(accountid, roleid);
    if (roleInfo === null) {
      this.logger.error("Role not found");
      throw new Error("Role not found");
    }
    delete roleInfo.accountid;

    let allPlatformModulePerms =
      await this.roleSvcI.GetAllPlatformModulePerms();
    if (!allPlatformModulePerms) {
      allPlatformModulePerms = [];
    }

    let rolePerms = await this.roleSvcI.GetRolePerms(accountid, roleid);
    if (!rolePerms) {
      rolePerms = [];
    }

    rolePerms = rolePerms.map((permid) => permid.permid);

    let permmap = {};

    for (let platformModulePerm of allPlatformModulePerms) {
      if (!permmap[platformModulePerm.moduleid]) {
        permmap[platformModulePerm.moduleid] = {
          moduleid: platformModulePerm.moduleid,
          moduleName: platformModulePerm.modulename,
          perms: [],
        };
      }
      let perm = {
        permid: platformModulePerm.permid,
        isassigned: false,
      };
      if (rolePerms.includes(platformModulePerm.permid)) {
        perm.isassigned = true;
      }
      permmap[platformModulePerm.moduleid].perms.push(perm);
    }

    permmap = Object.values(permmap);

    return {
      roleInfo: roleInfo,
      perms: permmap,
    };
  };

  /**
   * updatedperms is an array of objects with moduleid and permid
   * @param {*} roleid
   * @param {[{moduleid: string, selectedpermids: string[], deselectedpermids: string[]}]} updatedperms
   * @param {*} updatedby
   * @returns
   */
  UpdateRolePermsLogic = async (roleid, updatedperms, updatedby) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let permsToAdd = [];
    let permsToRemove = [];
    // TODO: temp code to prevent updating super admin role
    if (roleid === "ffffffff-ffff-ffff-ffff-ffffffffffff") {
      throw {
        errcode: "CANNOT_UPDATE_SUPER_ADMIN_ROLE",
        errdata: "Cannot update super admin role",
        message: "Cannot update super admin role",
      };
    }
    for (let updatedperm of updatedperms) {
      if (
        updatedperm.selectedpermids &&
        updatedperm.selectedpermids.length > 0
      ) {
        for (let permid of updatedperm.selectedpermids) {
          permsToAdd.push(permid);
        }
      }
      if (
        updatedperm.deselectedpermids &&
        updatedperm.deselectedpermids.length > 0
      ) {
        for (let permid of updatedperm.deselectedpermids) {
          permsToRemove.push(permid);
        }
      }
    }
    let res = await this.roleSvcI.UpdateRolePerms(
      accountid,
      roleid,
      permsToAdd,
      permsToRemove,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to update role permissions");
      throw new Error("Failed to update role permissions");
    }
    return this.GetRoleInfoLogic(roleid);
  };

  DeleteRoleLogic = async (roleid, deletedby) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    if (roleid === "ffffffff-ffff-ffff-ffff-ffffffffffff") {
      throw {
        errcode: "CANNOT_DELETE_ADMIN_ROLE",
        errdata: "Cannot delete admin role",
        message: "Cannot delete admin role",
      };
    }

    let roleInfo = await this.roleSvcI.GetRoleInfo(accountid, roleid);
    if (!roleInfo) {
      throw {
        errcode: "ROLE_NOT_FOUND",
        errdata: "Role not found",
        message: "Role not found",
      };
    }

    let isAssignedToUsers = await this.roleSvcI.IsRoleAssignedToUsers(roleid);
    if (isAssignedToUsers) {
      throw {
        errcode: "ROLE_IN_USE",
        errdata: "Role assigned to users",
        message:
          "Cannot delete role. It is currently assigned to one or more users.",
      };
    }

    let res = await this.roleSvcI.DeleteRole(roleid, deletedby);
    if (!res) {
      this.logger.error("Failed to delete role");
      throw new Error("Failed to delete role");
    }

    return {
      roleid: roleid,
      rolename: roleInfo.rolename,
      deletedat: new Date(),
      deletedby: deletedby,
    };
  };

  GetRoleHistoryLogic = async (starttime, endtime) => {
    let history = await this.roleSvcI.GetRoleHistory(starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };

  GetRolePermHistoryLogic = async (starttime, endtime) => {
    let history = await this.roleSvcI.GetRolePermHistory(starttime, endtime);
    if (!history) {
      history = [];
    }
    return history;
  };
}
