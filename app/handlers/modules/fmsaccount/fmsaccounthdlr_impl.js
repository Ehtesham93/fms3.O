import { v4 as uuidv4 } from "uuid";
import { publishVehicleUpdate } from "../../../utils/redisnotification.js";
import { formatLastUpdated } from "../../../utils/epochconverter.js";

export default class fmsAccountHdlrImpl {
  constructor(fmsAccountSvcI, userSvcI, logger, platformSvcI, redisSvc) {
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.userSvcI = userSvcI;
    this.logger = logger;
    this.platformSvcI = platformSvcI;
    this.redisSvc = redisSvc;
  }

  ListInvitesOfAccountLogic = async (accountid) => {
    let result = await this.fmsAccountSvcI.ListInvitesOfAccount(accountid);
    if (!result) {
      throw new Error("Failed to list invites of account");
    }

    const currentTime = new Date();

    for (let invite of result) {
      if (invite.invitestatus === "PENDING" && invite.expiresat) {
        const expiresAt = new Date(invite.expiresat);
        if (currentTime > expiresAt) {
          invite.invitestatus = "EXPIRED";
        }
      }
    }

    return result;
  };

  ListInvitesOfFleetLogic = async (accountid, fleetid, recursive = false) => {
    let result = await this.fmsAccountSvcI.ListInvitesOfFleet(
      accountid,
      fleetid,
      recursive
    );
    if (!result) {
      throw new Error("Failed to list invites of fleet");
    }

    const currentTime = new Date();

    for (let invite of result) {
      if (invite.invitestatus === "PENDING" && invite.expiresat) {
        const expiresAt = new Date(invite.expiresat);
        if (currentTime > expiresAt) {
          invite.invitestatus = "EXPIRED";
        }
      }
    }

    return result;
  };

  CancelEmailInviteLogic = async (accountid, inviteid, cancelledby) => {
    let result = await this.fmsAccountSvcI.CancelEmailInvite(
      accountid,
      inviteid,
      cancelledby
    );
    if (!result) {
      throw new Error("Failed to cancel email invite");
    }
    return result;
  };

  SendUserInviteLogic = async (
    accountid,
    fleetid,
    roleids,
    contact,
    invitedby,
    headerReferer
  ) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const indianMobileRegex = /^[6-9]\d{9}$/;
    const mahindrassoemailregex = /^[a-zA-Z0-9._%+-]+@mahindra\.com$/;
    if (mahindrassoemailregex.test(contact.toLowerCase())) {
      let inviteid = uuidv4();
      let res = await this.fmsAccountSvcI.SendMahindrassoInvite(
        accountid,
        fleetid,
        roleids,
        inviteid,
        contact,
        invitedby,
        headerReferer
      );
      if (!res) {
        throw new Error("Failed to send mahindrasso invite");
      }
      return {
        accountid: accountid,
        fleetid: res.fleetid,
        roleids: res.roleids,
        inviteid: inviteid,
        contact: res.inviteemail,
        type: "mahindrasso_invite",
      };
    } else if (emailRegex.test(contact)) {
      let inviteid = uuidv4();
      let res = await this.fmsAccountSvcI.SendEmailInvite(
        accountid,
        fleetid,
        roleids,
        inviteid,
        contact,
        invitedby,
        headerReferer
      );
      if (!res) {
        throw new Error("Failed to send email invite");
      }
      return {
        accountid: accountid,
        fleetid: res.fleetid,
        roleids: res.roleids,
        inviteid: inviteid,
        contact: res.inviteemail,
        type: "email_invite",
      };
    } else if (indianMobileRegex.test(contact)) {
      try {
        let userid = await this.userSvcI.GetUserIdByMobile(contact);

        if (!userid) {
          const displayname = `${contact}`;
          const userinfo = {};

          let createRes = await this.userSvcI.CreateUserByPlatformAdmin(
            "mobile",
            true,
            contact,
            displayname,
            userinfo,
            invitedby
          );

          if (!createRes) {
            throw new Error("Failed to create user");
          }

          userid = createRes.userid;
        }

        let res = await this.userSvcI.AddUserToAccount(
          invitedby,
          contact,
          accountid,
          fleetid,
          roleids
        );
        if (!res) {
          throw new Error("Failed to add user to account");
        }

        return {
          accountid: accountid,
          fleetid: fleetid,
          roleids: roleids,
          contact: contact,
          userid: userid,
          type: "mobile_user_added",
        };
      } catch (error) {
        if (error.message === "User with this mobile number does not exist") {
          throw error;
        }
        throw error;
      }
    } else {
      throw new Error("Invalid contact format");
    }
  };

  GetAccountOverviewLogic = async (accountid) => {
    try {
      const accountInfo = await this.fmsAccountSvcI.GetAccountInfo(accountid);

      const rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
      if (!rootFleetId) {
        throw new Error("Root fleet not found for account");
      }

      const fleetCount = await this.fmsAccountSvcI.GetFleetCount(accountid);

      const vehicles = await this.fmsAccountSvcI.GetVehicles(
        accountid,
        rootFleetId,
        true
      );
      const vehicleCount = vehicles ? vehicles.length : 0;

      const users = await this.fmsAccountSvcI.ListUsers(
        accountid,
        rootFleetId,
        true
      );
      const userCount = users ? users.length : 0;

      const subscriptionInfo =
        await this.fmsAccountSvcI.GetSubscriptionInfo(accountid);

      let subscribedVehicleCount = 0;
      try {
        const subscribedVehicles =
          await this.fmsAccountSvcI.GetSubscribedVehicles(accountid);
        subscribedVehicleCount = subscribedVehicles
          ? subscribedVehicles.length
          : 0;
      } catch (e) {
        this.logger.warn("Could not fetch subscribed vehicles:", e);
      }

      return {
        accountid: accountid,
        accountname: accountInfo.accountname,
        createdby: accountInfo.createdby,
        createdat: accountInfo.createdat,
        updatedby: accountInfo.updatedby,
        updatedat: accountInfo.updatedat,
        fleetcount: fleetCount || 0,
        vehiclecount: vehicleCount,
        usercount: userCount,
        subscribedvehiclecount: subscribedVehicleCount,
        subscription: subscriptionInfo || null,
        rootfleetid: rootFleetId.fleetid,
        overview: {
          totalfleets: fleetCount || 0,
          totalvehicles: vehicleCount,
          totalusers: userCount,
          subscribedvehicles: subscribedVehicleCount,
          activesubscription: subscriptionInfo ? true : false,
        },
      };
    } catch (error) {
      this.logger.error("GetAccountOverviewLogic error:", error);
      throw error;
    }
  };

  GetAccountFleetsLogic = async (accountid, userid) => {
    let fleets = await this.fmsAccountSvcI.GetUserAccountFleets(
      accountid,
      userid
    );
    if (!fleets) {
      fleets = [];
    }
    return fleets;
  };

  GetAccountModulesLogic = async (accountid, userid) => {
    try {
      let accountModules =
        await this.fmsAccountSvcI.GetAllAccountModules(accountid);

      let modules = [];
      for (let module of accountModules) {
        modules.push({
          moduleid: module.moduleid,
          moduleinfo: module,
        });
      }

      return {
        userid: userid,
        accountid: accountid,
        modules: modules,
      };
    } catch (error) {
      throw {
        errcode: "FAILED_TO_GET_ACCOUNT_MODULES",
        errdata: "Failed to get account modules",
        message: "Failed to get account modules",
      };
    }
  };

  GetChargeStationTypesLogic = async (accountid) => {
    try {
      let result = await this.fmsAccountSvcI.GetChargeStationTypes(accountid);
      return result;
    } catch (error) {
      throw error;
    }
  };

  ValidateInviteLogic = async (inviteid, userid) => {
    let result = await this.fmsAccountSvcI.ValidateInvite(inviteid, userid);
    if (!result) {
      throw new Error("Failed to validate invite");
    }
    return result;
  };

  ResendEmailInviteLogic = async (accountid, inviteid, resendedby, referer) => {
    let result = await this.fmsAccountSvcI.ResendInvite(
      accountid,
      inviteid,
      resendedby,
      referer
    );
    if (!result) {
      throw new Error("Failed to resend email invite");
    }
    return result;
  };

  // fleet management
  CreateFleetLogic = async (accountid, parentfleetid, fleetname, createdby) => {
    const trimmedFleetName = fleetname.trim();

    const reservedNames = ["Home"];
    if (reservedNames.includes(trimmedFleetName.toLowerCase())) {
      throw {
        errcode: "RESERVED_FLEET_NAME",
        errdata: "Reserved fleet name",
        message: "Fleet name is reserved and cannot be used",
      };
    }

    let totalFleets = await this.fmsAccountSvcI.GetFleetCount(accountid);
    if (totalFleets >= 1000) {
      throw {
        errcode: "FLEET_COUNT_LIMIT_EXCEEDED",
        errdata: "Maximum fleet count exceeded",
        message: "Cannot create more than 1000 fleets per account",
      };
    }

    let parentFleet = await this.fmsAccountSvcI.GetFleetInfo(
      accountid,
      parentfleetid
    );

    if (!parentFleet) {
      throw {
        errcode: "PARENT_FLEET_NOT_FOUND",
        errdata: "Parent fleet not found",
        message: "Parent fleet not found or does not belong to this account",
      };
    }

    if (!parentFleet.isroot) {
      let parentDepth = await this.fmsAccountSvcI.GetFleetDepthFromRoot(
        accountid,
        parentfleetid
      );
      if (parentDepth > 8) {
        throw {
          errcode: "FLEET_DEPTH_LIMIT_EXCEEDED",
          errdata: "Maximum fleet depth exceeded",
          message:
            "Cannot create fleet more than 8 levels deep from Home fleet",
        };
      }
    }

    let existingSubfleets = await this.fmsAccountSvcI.GetSubFleets(
      accountid,
      parentfleetid,
      false
    );

    if (existingSubfleets && existingSubfleets.length > 0) {
      const duplicateFleet = existingSubfleets.find(
        (fleet) =>
          fleet.fleetname &&
          fleet.fleetname.toLowerCase() === trimmedFleetName.toLowerCase()
      );

      if (duplicateFleet) {
        throw {
          errcode: "DUPLICATE_FLEET_NAME",
          errdata: "Fleet name already exists",
          message:
            "A fleet with this name already exists under the same parent fleet",
        };
      }
    }

    let fleetid = uuidv4();
    let result = await this.fmsAccountSvcI.CreateFleet(
      accountid,
      fleetid,
      parentfleetid,
      trimmedFleetName,
      createdby
    );

    if (!result) {
      throw new Error("Failed to create fleet");
    }

    return result;
  };

  GetFleetInfoLogic = async (accountid, fleetid) => {
    let fleet = await this.fmsAccountSvcI.GetFleetInfo(accountid, fleetid);
    if (!fleet) {
      throw new Error("Failed to get fleet info");
    }
    return fleet;
  };

  EditFleetLogic = async (accountid, fleetid, updateFields, updatedby) => {
    const allowedFields = ["name", "fleetinfo"];

    const fieldsToUpdate = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        fieldsToUpdate[key] = value;
      }
    }

    let fleet = await this.fmsAccountSvcI.EditFleet(
      accountid,
      fleetid,
      fieldsToUpdate,
      updatedby
    );
    if (!fleet) {
      throw new Error("Failed to edit fleet");
    }
    return fleet;
  };

  GetSubFleetsLogic = async (accountid, fleetid, recursive = false) => {
    let subfleets = await this.fmsAccountSvcI.GetSubFleets(
      accountid,
      fleetid,
      recursive
    );
    if (!subfleets) {
      throw new Error("Failed to get subfleets");
    }
    return subfleets;
  };

  DeleteFleetLogic = async (accountid, fleetid, deletedby) => {
    let fleetInfo = await this.fmsAccountSvcI.GetFleetInfo(accountid, fleetid);
    if (!fleetInfo) {
      throw {
        errcode: "FLEET_NOT_FOUND",
        errdata: "Fleet not found",
        message: "Fleet not found",
      };
    }

    if (fleetInfo.isroot) {
      throw {
        errcode: "ROOT_FLEET_PROTECTED",
        errdata: "Root fleet protected",
        message: "Cannot delete root fleet. It is protected from deletion.",
      };
    }

    let hasVehicles = await this.fmsAccountSvcI.DoesFleetHaveVehicles(
      accountid,
      fleetid
    );
    if (hasVehicles) {
      throw {
        errcode: "FLEET_HAS_VEHICLES",
        errdata: "Fleet has vehicles",
        message: "Cannot delete fleet. It has vehicles assigned to it.",
      };
    }

    let hasSubfleets = await this.fmsAccountSvcI.DoesFleetHaveSubfleets(
      accountid,
      fleetid
    );
    if (hasSubfleets) {
      throw {
        errcode: "FLEET_HAS_SUBFLEETS",
        errdata: "Fleet has subfleets",
        message:
          "Cannot delete fleet. It has subfleets. Please delete subfleets first.",
      };
    }

    let hasUsers = await this.fmsAccountSvcI.DoesFleetHaveUsers(
      accountid,
      fleetid
    );
    if (hasUsers) {
      throw {
        errcode: "FLEET_HAS_USERS",
        errdata: "Fleet has users",
        message: "Cannot delete fleet. It has users assigned to it.",
      };
    }

    let hasConstraints = await this.fmsAccountSvcI.DoesFleetHaveConstraints(
      accountid,
      fleetid
    );

    let res = await this.fmsAccountSvcI.DeleteFleet(
      accountid,
      fleetid,
      deletedby,
      hasConstraints
    );
    if (!res) {
      this.logger.error("Failed to delete fleet");
      throw new Error("Failed to delete fleet");
    }

    return {
      fleetid: fleetid,
      fleetname: fleetInfo.fleetname,
      deletedat: new Date(),
      deletedby: deletedby,
      deletetype: hasConstraints ? "soft" : "hard",
    };
  };

  ListSubscribedVehiclesLogic = async (accountid) => {
    let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
    if (!rootFleetId) {
      throw new Error("Failed to get root fleet for account");
    }

    let allVehicles = await this.GetVehiclesLogic(accountid, rootFleetId, true);
    if (!allVehicles) {
      allVehicles = [];
    }

    let subscriptionData =
      await this.fmsAccountSvcI.GetSubscribedVehiclesFromList(
        accountid,
        allVehicles
      );
    if (!subscriptionData) {
      subscriptionData = [];
    }

    let subscriptionMap = new Map();
    for (let subData of subscriptionData) {
      subscriptionMap.set(subData.vinno, {
        startsat: subData.startsat,
        endsat: subData.endsat,
        createdat: subData.createdat,
        createdby: subData.createdby,
      });
    }

    let subscribedVehicles = [];
    for (let vehicle of allVehicles) {
      if (subscriptionMap.has(vehicle.vinno)) {
        let subInfo = subscriptionMap.get(vehicle.vinno);
        subscribedVehicles.push({
          ...vehicle,
          subscriptionstartsat: subInfo.startsat,
          subscriptionendsat: subInfo.endsat,
          subscriptioncreatedat: subInfo.createdat,
          subscriptioncreatedby: subInfo.createdby,
        });
      }
    }

    return subscribedVehicles;
  };

  // role management
  CreateRoleLogic = async (
    accountid,
    rolename,
    roletype,
    isenabled,
    createdby
  ) => {
    let roleid = uuidv4();
    let role = {
      accountid: accountid,
      roleid: roleid,
      rolename: rolename,
      roletype: roletype,
      isenabled: !!isenabled,
      createdby: createdby,
    };
    let res = await this.fmsAccountSvcI.CreateRole(role);
    if (!res) {
      throw new Error("Failed to create role");
    }
    delete role.accountid;

    return {
      roleid: roleid,
      role: role,
    };
  };

  UpdateRoleLogic = async (accountid, roleid, updateFields, updatedby) => {
    const allowedFields = ["rolename", "roletype", "isenabled"];

    const filteredFields = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        filteredFields[key] = key === "isenabled" ? !!value : value;
      }
    }

    if (Object.keys(filteredFields).length === 0) {
      throw new Error("No valid fields provided for update");
    }

    const res = await this.fmsAccountSvcI.UpdateRole(
      accountid,
      roleid,
      filteredFields,
      updatedby
    );
    if (!res) {
      throw new Error("Failed to update role");
    }

    return {
      roleid: roleid,
      role: {
        roleid: roleid,
        ...filteredFields,
        updatedby: updatedby,
      },
    };
  };

  ListRolesLogic = async (accountid) => {
    let roles = await this.fmsAccountSvcI.GetAllRoles(accountid);
    if (!roles) {
      roles = [];
    }
    return {
      roles: roles,
    };
  };

  GetRoleInfoLogic = async (accountid, roleid) => {
    let roleInfo = await this.fmsAccountSvcI.GetRoleInfo(accountid, roleid);
    if (roleInfo === null) {
      throw {
        errcode: "ROLE_NOT_FOUND",
        errdata: "Role not found",
        message: "Role not found",
      };
    }
    roleInfo.isadmin = false;
    roleInfo.isreadonly = false;

    let accountModules =
      await this.fmsAccountSvcI.GetAllAccountModules(accountid);

    if (!accountModules) {
      accountModules = [];
    }

    let accountModuleIds = accountModules.map((m) => m.moduleid);

    let accountModulePerms =
      await this.fmsAccountSvcI.GetAllModulePerms(accountModuleIds);

    if (!accountModulePerms) {
      accountModulePerms = [];
    }

    let rolePerms = await this.fmsAccountSvcI.GetRolePermsForAccount(
      accountid,
      roleid
    );

    if (!rolePerms) {
      rolePerms = [];
    }

    rolePerms = rolePerms.map((perm) => perm.permid);
    if (rolePerms.includes("all.all.all")) {
      roleInfo.isadmin = true;
      roleInfo.isreadonly = true;
    }

    let permMap = {};

    for (let module of accountModules) {
      permMap[module.moduleid] = {
        moduleid: module.moduleid,
        modulename: module.modulename,
        modulepriority: module.priority,
        perms: [],
      };
    }

    for (let accountModulePerm of accountModulePerms) {
      if (!permMap[accountModulePerm.moduleid]) {
        continue;
      }

      let perm = {
        permid: accountModulePerm.permid,
        isassigned: false,
      };

      if (rolePerms.includes(accountModulePerm.permid) || roleInfo.isadmin) {
        perm.isassigned = true;
      }

      permMap[accountModulePerm.moduleid].perms.push(perm);
    }

    permMap = Object.values(permMap);

    return {
      roleinfo: roleInfo,
      perms: permMap,
    };
  };

  // vehicle management
  GetVehiclesLogic = async (
    accountid,
    fleetid,
    recursive = false,
    isforcedfilter = false
  ) => {
    let vehicles = await this.fmsAccountSvcI.GetVehicles(
      accountid,
      fleetid,
      recursive,
      isforcedfilter
    );
    if (!vehicles) {
      return [];
    }
    return vehicles;
  };

  MoveVehicleLogic = async (accountid, fromfleetid, tofleetid, vehicleid) => {
    let result = await this.fmsAccountSvcI.MoveVehicle(
      accountid,
      fromfleetid,
      tofleetid,
      vehicleid
    );
    if (!result) {
      throw new Error("Failed to move vehicle");
    }

    const message = {
      srcfleetid: fromfleetid,
      dstfleetid: tofleetid,
      srcaccountid: accountid,
      dstaccountid: accountid,
      action: "MOVED",
      description: "Vehicle moved from source fleet to destination fleet",
      timestamp: new Date().toISOString(),
    }
    // set and publish vehicle update
    await publishVehicleUpdate(
      accountid,
      message,
      this.redisSvc,
      this.logger
    );

    return result;
  };

  RemoveVehicleLogic = async (accountid, fleetid, vehicleid) => {
    let result = await this.fmsAccountSvcI.RemoveVehicle(
      accountid,
      fleetid,
      vehicleid
    );
    if (!result) {
      throw new Error("Failed to remove vehicle");
    }
    let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
    if (!rootFleetId) {
      rootFleetId = null;
    }
    // set and publish vehicle update
    const message = {
      srcfleetid: fleetid,
      dstfleetid: rootFleetId,
      srcaccountid: accountid,
      dstaccountid: accountid,
      action: "REMOVED",
      description: "Vehicle removed from fleet",
      timestamp: new Date().toISOString(),
    }
    // set and publish vehicle update
    await publishVehicleUpdate(
      accountid,
      message,
      this.redisSvc,
      this.logger
    );

    return result;
  };

  ListMoveableFleetsLogic = async (accountid, vehicleid, userid) => {
    let fleets = await this.fmsAccountSvcI.ListMoveableFleets(
      accountid,
      vehicleid,
      userid
    );
    if (!fleets) {
      return [];
    }
    return fleets;
  };

  // user management
  ListUsersLogic = async (accountid, fleetid, recursive = false) => {
    let users = await this.fmsAccountSvcI.ListUsers(
      accountid,
      fleetid,
      recursive
    );
    if (!users) {
      return [];
    }
    return users;
  };

  GetAssignableRolesLogic = async (accountid, fleetid, userid, assignedby) => {
    let roles = await this.fmsAccountSvcI.GetAssignableRoles(
      accountid,
      fleetid,
      userid,
      assignedby
    );
    if (!roles) {
      return [];
    }
    return roles;
  };

  AssignUserRoleLogic = async (
    accountid,
    fleetid,
    userid,
    roleids,
    assignedby
  ) => {
    let result = await this.fmsAccountSvcI.AssignUserRole(
      accountid,
      fleetid,
      userid,
      roleids,
      assignedby
    );
    if (!result) {
      throw new Error("Failed to assign user role");
    }
    return result;
  };

  DeassignUserRoleLogic = async (
    accountid,
    fleetid,
    userid,
    roleid,
    deassignedby
  ) => {
    let result = await this.fmsAccountSvcI.DeassignUserRole(
      accountid,
      fleetid,
      userid,
      roleid,
      deassignedby
    );
    if (!result) {
      throw new Error("Failed to deassign user role");
    }
    return result;
  };

  GetUserInfoLogic = async (accountid, fleetid, userid) => {
    let user = await this.userSvcI.GetUserDetails(userid);
    if (!user) {
      throw new Error("User not found");
    }

    let userRoles = await this.fmsAccountSvcI.GetAllUserRolesOnFleet(
      accountid,
      fleetid,
      userid
    );
    if (!userRoles) {
      userRoles = [];
    }

    let accountRoles = userRoles.filter((role) => role.roletype === "account");
    accountRoles = accountRoles.map((role) => {
      return {
        fleetid: role.fleetid,
        fleetname: role.fleetname,
        roleid: role.roleid,
        rolename: role.rolename,
        roletype: role.roletype,
      };
    });

    return {
      user: user,
      roles: {
        account: accountRoles,
      },
    };
  };

  RemoveUserLogic = async (accountid, userid, removedby) => {
    if (userid === removedby) {
      throw {
        errcode: "CANNOT_REMOVE_SELF",
        errdata: "Cannot remove self",
        message: "You cannot remove yourself from the account",
      };
    }

    if (userid === "ffffffff-ffff-ffff-ffff-ffffffffffff") {
      throw {
        errcode: "CANNOT_REMOVE_SEED_USER",
        errdata: "Cannot remove seed user",
        message:
          "Cannot remove seed user (super admin). It is protected from removal.",
      };
    }

    // Check if user exists
    let userDetails = await this.userSvcI.GetUserDetails(userid);
    if (!userDetails) {
      throw {
        errcode: "USER_NOT_FOUND",
        errdata: "User not found",
        message: "User not found",
      };
    }

    if (userDetails.isdeleted) {
      throw {
        errcode: "USER_NOT_FOUND",
        errdata: "User not found",
        message: "User not found or already deleted",
      };
    }

    // Check if user is part of this account
    let isUserInAccount = await this.fmsAccountSvcI.IsUserInAccount(
      accountid,
      userid
    );
    if (!isUserInAccount) {
      throw {
        errcode: "USER_NOT_IN_ACCOUNT",
        errdata: "User not in account",
        message: "User is not a member of this account",
      };
    }

    let result = await this.fmsAccountSvcI.RemoveUser(
      accountid,
      userid,
      removedby
    );
    if (!result) {
      this.logger.error("Failed to remove user from account");
      throw new Error("Failed to remove user from account");
    }

    return {
      userid: userid,
      accountid: accountid,
      removedby: removedby,
      removedat: new Date(),
      message: "User removed from account successfully",
    };
  };

  /**
   * updatedperms is an array of objects with moduleid and permid
   * @param {*} roleid
   * @param {[{moduleid: string, selectedpermids: string[], deselectedpermids: string[]}]} updatedperms
   * @param {*} updatedby
   * @returns
   */
  UpdateRolePermsLogic = async (accountid, roleid, updatedperms, updatedby) => {
    let roleInfo = await this.fmsAccountSvcI.GetRoleInfo(accountid, roleid);
    if (!roleInfo) {
      throw {
        errcode: "ROLE_NOT_FOUND",
        errdata: "Role not found",
        message: "Role not found",
      };
    }
    let permsToAdd = [];
    let permsToRemove = [];
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
    let res = await this.fmsAccountSvcI.UpdateRolePerms(
      accountid,
      roleid,
      permsToAdd,
      permsToRemove,
      updatedby
    );
    if (!res) {
      throw new Error("Failed to update role permissions");
    }
    return this.GetRoleInfoLogic(accountid, roleid);
  };

  DeleteRoleLogic = async (accountid, roleid, deletedby) => {
    // Check if role exists and get role info
    let roleInfo = await this.fmsAccountSvcI.GetRoleInfo(accountid, roleid);
    if (!roleInfo) {
      throw {
        errcode: "ROLE_NOT_FOUND",
        errdata: "Role not found",
        message: "Role not found",
      };
    }

    if (roleid === "ffffffff-ffff-ffff-ffff-ffffffffffff") {
      throw {
        errcode: "CANNOT_DELETE_ADMIN_ROLE",
        errdata: "Cannot delete admin role",
        message: "Cannot delete admin role. It is protected from deletion.",
      };
    }

    if (roleInfo.roletype !== "account") {
      throw {
        errcode: "INVALID_ROLE_TYPE",
        errdata: "Invalid role type",
        message:
          "Only account roles can be deleted. Platform roles are protected.",
      };
    }

    let isAssignedToUsers =
      await this.fmsAccountSvcI.IsRoleAssignedToUsers(roleid);
    if (isAssignedToUsers) {
      throw {
        errcode: "ROLE_IN_USE",
        errdata: "Role assigned to users",
        message:
          "Cannot delete role. It is currently assigned to one or more users.",
      };
    }

    let hasPermissions =
      await this.fmsAccountSvcI.DoesRoleHavePermissions(roleid);
    if (hasPermissions) {
      throw {
        errcode: "ROLE_HAS_PERMISSIONS",
        errdata: "Role has permissions",
        message: "Cannot delete role. It has permissions assigned.",
      };
    }

    let res = await this.fmsAccountSvcI.DeleteRole(roleid, deletedby);
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
    let result = await this.fmsAccountSvcI.GetRoleHistory(starttime, endtime);
    if (!result) {
      return [];
    }
    return result;
  };

  GetRolePermHistoryLogic = async (starttime, endtime) => {
    let result = await this.fmsAccountSvcI.GetRolePermHistory(starttime, endtime);
    if (!result) {
      return [];
    }
    return result;
  };

  // subscription management
  GetAccountSubscriptionsLogic = async (accountid) => {
    let defaultPkgs = await this.fmsAccountSvcI.GetDefaultAccountPkgs();
    if (!defaultPkgs) {
      defaultPkgs = [];
    }
    let customPkgs = await this.fmsAccountSvcI.GetCustomAccountPkgs(accountid);
    if (!customPkgs) {
      customPkgs = [];
    }

    let subscription = await this.fmsAccountSvcI.GetSubscriptionInfo(accountid);
    let activepkgid = subscription?.pkgid;

    for (let pkg of defaultPkgs) {
      let totalcredits = 0;
      if (pkg.modules && pkg.modules.length > 0) {
        for (let module of pkg.modules) {
          totalcredits += Number(module.creditspervehicleday);
        }
      }
      pkg.totalcredits = totalcredits;

      pkg.issubscribed = pkg.pkgid === activepkgid;
      if (pkg.issubscribed && subscription) {
        pkg.subscriptioninfo = {
          startdate: subscription.subscriptioninfo.startdate,
          enddate: subscription.subscriptioninfo.enddate,
        };
      }
    }

    for (let pkg of customPkgs) {
      let totalcredits = 0;
      if (pkg.modules && pkg.modules.length > 0) {
        for (let module of pkg.modules) {
          totalcredits += Number(module.creditspervehicleday);
        }
      }
      pkg.totalcredits = totalcredits;

      pkg.issubscribed = pkg.pkgid === activepkgid;
      if (pkg.issubscribed && subscription) {
        pkg.subscriptioninfo = {
          startdate: subscription.subscriptioninfo.startdate,
          enddate: subscription.subscriptioninfo.enddate,
        };
      }
    }

    return {
      accountid: accountid,
      defaultpkgs: defaultPkgs,
      custompkgs: customPkgs,
    };
  };

  CheckChangeSubscriptionPackageLogic = async (accountid, newpkgid) => {
    let res = await this.fmsAccountSvcI.CheckChangeSubscriptionPackage(
      accountid,
      newpkgid
    );
    if (!res) {
      throw new Error("Failed to check change subscription package");
    }
    return { accountid: accountid, pkgid: newpkgid, subscriptioninfo: res };
  };

  UpdateAccountSubscriptionLogic = async (accountid, pkgid, updatedby) => {
    let currentTime = new Date();
    let endTime = new Date(currentTime);
    endTime.setFullYear(endTime.getFullYear() + 5);

    let subscriptioninfo = {
      startdate: currentTime.toISOString(),
      enddate: endTime.toISOString(),
    };

    let result = await this.fmsAccountSvcI.UpdateSubscription(
      accountid,
      pkgid,
      subscriptioninfo,
      updatedby
    );
    if (!result) {
      throw new Error("Failed to update subscription");
    }
    return {
      accountid: accountid,
      pkgid: pkgid,
      subscription: subscriptioninfo,
    };
  };

  GetSubscriptionHistoryLogic = async (accountid) => {
    let subscriptionHistory =
      await this.fmsAccountSvcI.GetSubscriptionHistory(accountid);
    if (!subscriptionHistory) {
      subscriptionHistory = [];
    }
    return subscriptionHistory;
  };

  GetSubscriptionVehiclesLogic = async (accountid) => {
    let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
    if (!rootFleetId) {
      throw new Error("Failed to get root fleet for account");
    }

    const isforcedfilter = true;
    let allVehicles = await this.GetVehiclesLogic(
      accountid,
      rootFleetId,
      true,
      isforcedfilter
    );
    if (!allVehicles) {
      allVehicles = [];
    }

    const vinNumbers = allVehicles.map((vehicle) => vehicle.vinno);
    const gpsDataMap =
      await this.fmsAccountSvcI.GetLastestGpsDataForVehicles(vinNumbers);

    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

    let subscriptionInfo =
      await this.fmsAccountSvcI.GetSubscriptionInfo(accountid);

    let currentPackage = null;
    if (subscriptionInfo) {
      let packageDetails = await this.fmsAccountSvcI.GetPackageWithModules(
        subscriptionInfo.pkgid
      );
      if (packageDetails) {
        let totalCredits = 0;
        if (packageDetails.modules && packageDetails.modules.length > 0) {
          for (let module of packageDetails.modules) {
            totalCredits += Number(module.creditspervehicleday);
          }
        }

        currentPackage = {
          pkgid: packageDetails.pkgid,
          pkgname: packageDetails.pkgname,
          pkgtype: packageDetails.pkgtype,
          totalcredits: totalCredits,
          modules: packageDetails.modules,
          subscriptioninfo: {
            startdate: subscriptionInfo.subscriptioninfo.startdate,
            enddate: subscriptionInfo.subscriptioninfo.enddate,
          },
          subscribeddate: subscriptionInfo.createdat,
          subscribedby: subscriptionInfo.createdby,
        };
      }
    }

    // let subscribedVehiclesData =
    //   await this.fmsAccountSvcI.GetSubscribedVehicles(accountid);

    const [subscribedVehiclesData, allvehiclessourceaccount] = await Promise.all([
      this.fmsAccountSvcI.GetSubscribedVehicles(accountid),
      this.fmsAccountSvcI.GetAllVehiclesSourceAccount(vinNumbers)
    ]);
    if (!subscribedVehiclesData) {
      subscribedVehiclesData = [];
    }

    let sourceAccountMap = new Map();
    if (allvehiclessourceaccount) {
      for (let sourceAccount of allvehiclessourceaccount) {
        sourceAccountMap.set(sourceAccount.vinno, {
          sourceaccountid: sourceAccount.srcaccountid,
          sourceaccountname: sourceAccount.accountname,
          dstaccountid: sourceAccount.dstaccountid,
        });
      }
    }

    let subscriptionMap = new Map();
    let currentDate = new Date();

    for (let subData of subscribedVehiclesData) {
      subscriptionMap.set(subData.vinno, {
        issubscribed: true,
        isunsubscribable: subData.lockedtill
          ? currentDate > new Date(subData.lockedtill)
          : false,
        endsat: subData.endsat,
        startsat: subData.startsat,
        lockedtill: subData.lockedtill,
        sourceaccountid: subData.sourceaccountid,
        sourceaccountname: subData.sourceaccountname,
      });
    }

    let subscribedVehicles = [];
    let unsubscribedvehicles = [];

    for (let vehicle of allVehicles) {
      const lastConnectedAt = gpsDataMap[vehicle.vinno]
        ? parseInt(gpsDataMap[vehicle.vinno])
        : null;
      const isConnected =
        lastConnectedAt && lastConnectedAt > twentyFourHoursAgo ? true : false;

      if (subscriptionMap.has(vehicle.vinno)) {
        let subInfo = subscriptionMap.get(vehicle.vinno);
        subscribedVehicles.push({
          ...vehicle,
          sourceaccountid: subInfo.sourceaccountid,
          sourceaccountname: subInfo.sourceaccountname,
          issubscribed: true,
          isunsubscribable: subInfo.isunsubscribable,
          subscriptionstartsat: subInfo.startsat,
          subscriptionlockedtill: subInfo.lockedtill,
          subscriptionendsat: subInfo.endsat,
          lastconnectedat: lastConnectedAt,
          isconnected: isConnected,
          issubscribable: false,
        });
      } else {
        unsubscribedvehicles.push({
          ...vehicle,
          sourceaccountid: sourceAccountMap.get(vehicle.vinno)?.sourceaccountid,
          sourceaccountname: sourceAccountMap.get(vehicle.vinno)?.sourceaccountname,
          issubscribed: false,
          isunsubscribable: false,
          issubscribable: isConnected,
          lastconnectedat: lastConnectedAt,
          isconnected: isConnected,
        });
      }
    }

    return {
      accountid: accountid,
      currentpackage: currentPackage,
      vehicles: {
        subscribed: subscribedVehicles,
        unsubscribed: unsubscribedvehicles,
        total: allVehicles.length,
        subscribedcount: subscribedVehicles.length,
        unsubscribedcount: unsubscribedvehicles.length,
      },
    };
  };

  GetSubscriptionVehiclesHistoryLogic = 
  async (accountid, starttime, endtime) => {
    const statusMap = {
      0: "pending",
      1: "subscribed",
      2: "staged_for_disable",
      3: "unsubscribed",
    };

    const subscriptionHistoryInfo =
      await this.fmsAccountSvcI.GetSubscriptionHistoryInfo(accountid, starttime, endtime);

    // Expecting an array of rows. Convert to required shape.
    const history = (subscriptionHistoryInfo || []).map((r) => ({
      accountid: accountid,
      lastupdated: formatLastUpdated(r.updatedat),
      regno: r.regno,
      vin: r.vinno,
      isowner: r.isowner,
      status: (statusMap[r.state] ?? String(r.state)).toUpperCase(),
    }));

    return history;
  };

  CreateSubscriptionIntentLogic = async (accountid, vinnos, userid) => {
    const originalcount = vinnos.length;
    const uniquevins = [...new Set(vinnos)];

    let result = await this.fmsAccountSvcI.CreateSubscriptionIntent(
      accountid,
      uniquevins,
      userid,
      originalcount
    );
    if (!result) {
      throw new Error("Failed to create subscription intent");
    }
    return result;
  };

  SubscribeVehicleLogic = async (accountid, vinnos, userid) => {
    const originalcount = vinnos.length;
    const uniquevins = [...new Set(vinnos)];

    if (originalcount !== uniquevins.length) {
      return {
        status: "error",
        message: `Duplicate VINs found and filtered out. Original: ${originalcount}, Unique: ${uniquevins.length}`,
        details: {
          originalcount,
          uniquevins: uniquevins.length,
          duplicatecount: originalcount - uniquevins.length,
        },
      };
    }

    let intentResult = await this.fmsAccountSvcI.CreateSubscriptionIntent(
      accountid,
      uniquevins,
      userid,
      originalcount
    );

    if (!intentResult) {
      return {
        status: "error",
        message: "Failed to validate subscription intent",
        details: {
          accountid,
          vinnos: uniquevins,
        },
      };
    }

    const errorResults = intentResult.vinresults.filter(
      (r) => r.status === "error"
    );

    if (errorResults.length > 0) {
      const errorDetails = errorResults
        .map((r) => `${r.vinno}: ${r.reason} - ${r.message}`)
        .join("; ");

      return {
        status: "error",
        message: "Cannot subscribe vehicles. Validation failed",
        details: {
          failedvehicles: errorResults.map((r) => ({
            vinno: r.vinno,
            reason: r.reason,
            message: r.message,
            details: r.details || {},
          })),
          errorcount: errorResults.length,
          totalvehicles: uniquevins.length,
        },
        vinresults: intentResult.vinresults,
      };
    }

    const subscribableVehicles = intentResult.vinresults
      .filter((r) => r.status === "success")
      .map((r) => r.vinno);

    if (subscribableVehicles.length !== uniquevins.length) {
      return {
        status: "error",
        message: "Validation inconsistency detected",
        details: {
          expectedcount: uniquevins.length,
          actualcount: subscribableVehicles.length,
          vinnos: uniquevins,
        },
      };
    }

    let result = await this.fmsAccountSvcI.SubscribeVehicle(
      accountid,
      subscribableVehicles,
      userid,
      intentResult
    );

    if (!result) {
      return {
        status: "error",
        message: "Failed to subscribe vehicles",
        details: {
          accountid,
          vinnos: subscribableVehicles,
        },
      };
    }

    return result;
  };

  UnsubscribeVehicleLogic = async (accountid, vinnos, userid) => {
    const originalcount = vinnos.length;
    const uniquevins = [...new Set(vinnos)];

    if (originalcount !== uniquevins.length) {
      return {
        status: "error",
        message: `Duplicate VINs found and filtered out. Original: ${originalcount}, Unique: ${uniquevins.length}`,
        details: {
          originalcount,
          uniquevins: uniquevins.length,
          duplicatecount: originalcount - uniquevins.length,
        },
      };
    }

    let result = await this.fmsAccountSvcI.UnsubscribeVehicle(
      accountid,
      uniquevins,
      userid
    );

    if (!result) {
      return {
        status: "error",
        message: "Failed to unsubscribe vehicles",
        details: {
          accountid,
          vinnos: uniquevins,
        },
      };
    }

    return result;
  };

  GetAccountCreditsLogic = async (accountid) => {
    let credits = await this.fmsAccountSvcI.GetAccountCredits(accountid);
    if (!credits) {
      credits = 0;
    }
    return { accountid: accountid, credits: credits };
  };

  GetAccountCreditsOverviewLogic = async (accountid, starttime, endtime) => {
    let overview = await this.fmsAccountSvcI.GetAccountCreditsOverview(
      accountid,
      starttime,
      endtime
    );

    const chartData = {
      accountid: accountid,
      credits: {
        dates: [], // targetdate values for x-axis
        creditsadded: [],
        creditsconsumed: [],
      },
      vehicles: {
        dates: [], // targetdate values for x-axis
        totalvehicles: [],
        subscribedvehicles: [],
        connectedvehicles: [],
      },
    };

    overview.forEach((item) => {
      chartData.credits.dates.push(item.targetdate);
      chartData.vehicles.dates.push(item.targetdate);

      chartData.credits.creditsadded.push(item.creditsadded || 0);
      chartData.credits.creditsconsumed.push(-(item.creditsconsumed || 0));

      chartData.vehicles.totalvehicles.push(item.totalvehicles || 0);
      chartData.vehicles.subscribedvehicles.push(item.subscribedvehicles || 0);
      chartData.vehicles.connectedvehicles.push(item.connectedvehicles || 0);
    });

    return chartData;
  };

  GetAccountCreditsHistoryLogic = async (accountid, starttime, endtime) => {
    let history = await this.fmsAccountSvcI.GetAccountCreditsHistory(
      accountid,
      starttime,
      endtime
    );
    if (!history) {
      history = [];
    }

    return { accountid: accountid, history: history };
  };

  GetAccountVehicleCreditsHistoryLogic = async (
    accountid,
    vinno,
    fleetid,
    starttime,
    endtime
  ) => {
    // check if vinno is in fleetid with recursive true
    let vehicles = await this.GetVehiclesLogic(accountid, fleetid, true, true);
    if (!vehicles || vehicles.length === 0) {
      vehicles = [];
    }
    if (!vehicles.some((v) => v.vinno === vinno)) {
      throw {
        errcode: "INPUT_ERROR",
        errdata: "Vehicle not found in fleet",
        message: "Vehicle not found in fleet",
      };
    }

    let history = await this.fmsAccountSvcI.GetAccountVehicleCreditsHistory(
      accountid,
      [vinno],
      starttime,
      endtime
    );
    return {
      accountid: accountid,
      fleetid: fleetid,
      vinno: vinno,
      history: history,
    };
  };

  GetAccountFleetCreditsHistoryLogic = async (
    accountid,
    fleetid,
    starttime,
    endtime,
    recursive
  ) => {
    let vehicles = await this.GetVehiclesLogic(
      accountid,
      fleetid,
      recursive,
      true
    );
    if (!vehicles || vehicles.length === 0) {
      vehicles = [];
    }

    let history = await this.fmsAccountSvcI.GetAccountVehicleCreditsHistory(
      accountid,
      vehicles.map((v) => v.vinno),
      starttime,
      endtime
    );
    if (!history) {
      history = [];
    }
    return {
      accountid: accountid,
      fleetid: fleetid,
      history: history,
    };
  };

  TagVehicleLogic = async (
    srcaccountid,
    dstaccountid,
    vinnos,
    allow_retag,
    taggedby
  ) => {
    // const originalcount = vinnos.length;

    // if (originalcount !== uniquevins.length) {
    //   return {
    //     status: "error",
    //     message: `Duplicate VINs found and filtered out. Original: ${originalcount}, Unique: ${uniquevins.length}`,
    //     details: {
    //       originalcount,
    //       uniquevins: uniquevins.length,
    //       duplicatecount: originalcount - uniquevins.length,
    //     },
    //   };
    // }

    const uniquevins = [...new Set(vinnos)];
    let result = await this.fmsAccountSvcI.TagVehicle(
      srcaccountid,
      dstaccountid,
      uniquevins,
      allow_retag,
      taggedby
    );

    if (!result) {
      return {
        status: "error",
        message: "Failed to tag vehicles",
        details: {
          srcaccountid,
          dstaccountid,
          vinnos: uniquevins,
        },
      };
    }

    let srcrootFleetId = await this.fmsAccountSvcI.GetRootFleetId(srcaccountid);
    if (!srcrootFleetId) {
      srcrootFleetId = null;
    }
    let dstrootFleetId = await this.fmsAccountSvcI.GetRootFleetId(dstaccountid);
    if (!dstrootFleetId) {
      dstrootFleetId = null;
    }
    // set and publish vehicle update
    const message = {
      srcfleetid: srcrootFleetId,
      dstfleetid: dstrootFleetId,
      srcaccountid: srcaccountid,
      dstaccountid: dstaccountid,
      action: "TAGGED",
      description: "Vehicle tagged from source account to destination account",
      timestamp: new Date().toISOString(),
    }
    // set and publish vehicle update
    await publishVehicleUpdate(
      dstaccountid,
      message,
      this.redisSvc,
      this.logger
    );

    return result;
  };

  UntagVehicleLogic = async (
    srcaccountid,
    dstaccountid,
    vinnos,
    untaggedby
  ) => {
    // const originalcount = vinnos.length;

    // if (originalcount !== uniquevins.length) {
    //   return {
    //     status: "error",
    //     message: `Duplicate VINs found and filtered out. Original: ${originalcount}, Unique: ${uniquevins.length}`,
    //     details: {
    //       originalcount,
    //       uniquevins: uniquevins.length,
    //       duplicatecount: originalcount - uniquevins.length,
    //     },
    //   };
    // }

    const uniquevins = [...new Set(vinnos)];
    let result = await this.fmsAccountSvcI.UntagVehicle(
      srcaccountid,
      dstaccountid,
      uniquevins,
      untaggedby
    );

    if (!result) {
      return {
        status: "error",
        message: "Failed to untag vehicles",
        details: {
          srcaccountid,
          dstaccountid,
          vinnos: uniquevins,
        },
      };
    }

    let srcrootFleetId = await this.fmsAccountSvcI.GetRootFleetId(srcaccountid);
    if (!srcrootFleetId) {
      srcrootFleetId = null;
    }
    let dstrootFleetId = await this.fmsAccountSvcI.GetRootFleetId(dstaccountid);
    if (!dstrootFleetId) {
      dstrootFleetId = null;
    }
    // set and publish vehicle update
    const message = {
      srcfleetid: srcrootFleetId,
      dstfleetid: dstrootFleetId,
      srcaccountid: srcaccountid,
      dstaccountid: dstaccountid,
      action: "UNTAGGED",
      description: "Vehicle untagged from source account to destination account",
      timestamp: new Date().toISOString(),
    }
    // set and publish vehicle update
    await publishVehicleUpdate(
      dstaccountid,
      message,
      this.redisSvc,
      this.logger
    );

    return result;
  };

  GetSharedVehiclesLogic = async (accountid) => {
    try {
      let sharedVehicles =
        await this.fmsAccountSvcI.GetSharedVehicles(accountid);
      return sharedVehicles;
    } catch (error) {
      this.logger.error("GetSharedVehiclesLogic error: ", error);
      throw error;
    }
  };

  GetSharedAccountsLogic = async (accountid, vinno) => {
    try {
      // First verify that the vehicle belongs to this account
      let vehicleInfo = await this.fmsAccountSvcI.GetVehicleInfo(
        accountid,
        vinno
      );
      if (!vehicleInfo) {
        throw {
          errcode: "VEHICLE_NOT_FOUND",
          message: "Vehicle not found in this account",
        };
      }

      let sharedAccounts = await this.fmsAccountSvcI.GetSharedAccounts(
        accountid,
        vinno
      );
      return {
        vehicleinfo: vehicleInfo,
        sharedaccounts: sharedAccounts,
      };
    } catch (error) {
      this.logger.error("GetSharedAccountsLogic error: ", error);
      throw error;
    }
  };

  GetVehiclesSharedToMeLogic = async (accountid) => {
    try {
      let sharedToMeVehicles =
        await this.fmsAccountSvcI.GetVehiclesSharedToMe(accountid);
      return sharedToMeVehicles;
    } catch (error) {
      this.logger.error("GetVehiclesSharedToMeLogic error: ", error);
      throw error;
    }
  };

  GetMyFleetPermissionsLogic = async (userid, accountid, fleetid) => {
    const fleetInfo = await this.fmsAccountSvcI.GetFleetInfo( //TODO optimize this by just checking existence
      accountid,
      fleetid
    );
    if (!fleetInfo) {
      throw {
        errcode: "FLEET_NOT_FOUND",
        errdata: "Fleet not found",
        message: "Fleet not found or does not belong to this account",
      };
    }

    const userRoles = await this.fmsAccountSvcI.GetAllUserRolesOnFleet(
      accountid,
      fleetid,
      userid
    );

    if (!userRoles || userRoles.length === 0) {
      return {
        permissions: [],
        permissionsbymodule: [],
      };
    }

    let accountModules =
      await this.fmsAccountSvcI.GetAllAccountModules(accountid);
    if (!accountModules) {
      accountModules = [];
    }

    const webModules = accountModules.filter(
      (module) => module.moduletype === "web" || !module.moduletype
    );

    const accountModuleIds = webModules.map((m) => m.moduleid);

    let accountModulePerms =
      await this.fmsAccountSvcI.GetAllModulePerms(accountModuleIds);
    if (!accountModulePerms) {
      accountModulePerms = [];
    }

    let userPermissions = await this.userSvcI.GetRolePerms(
      accountid,
      fleetid,
      userid
    );
    if (!userPermissions) {
      userPermissions = [];
    }

    const isAdmin =
      userPermissions.includes("all.all.all") ||
      userRoles.some((role) => role.rolename.toLowerCase() === "admin");
    const isView =
      userPermissions.includes("all.all.view") ||
      userRoles.some((role) => role.rolename.toLowerCase() === "viewer");
    if (isAdmin) {
      if (!userPermissions.includes("all.all.all")) {
        userPermissions.push("all.all.all");
      }

      for (const accountModulePerm of accountModulePerms) {
        if (!userPermissions.includes(accountModulePerm.permid)) {
          userPermissions.push(accountModulePerm.permid);
        }
      }
    } else if (isView) {
      if (!userPermissions.includes("all.all.view")) {
        userPermissions.push("all.all.view");
      }
      for (const accountModulePerm of accountModulePerms) {
        if (!userPermissions.includes(accountModulePerm.permid) && accountModulePerm.permid.endsWith(".view")) {
          userPermissions.push(accountModulePerm.permid);
        }
      }
    }

    const permMap = {};

    for (const module of webModules) {
      permMap[module.moduleid] = {
        moduleid: module.moduleid,
        modulename: module.modulename,
        modulepriority: module.priority,
        perms: [],
      };
    }

    for (const accountModulePerm of accountModulePerms) {
      if (!permMap[accountModulePerm.moduleid]) {
        continue;
      }

      if (userPermissions.includes(accountModulePerm.permid) || isAdmin) {
        const perm = {
          permid: accountModulePerm.permid,
          isassigned: true,
        };
        permMap[accountModulePerm.moduleid].perms.push(perm);
      }
    }

    const permissionsbymodule = Object.values(permMap).filter(
      (module) => module.perms.length > 0
    );

    return {
      permissions: userPermissions,
      permissionsbymodule: permissionsbymodule,
    };
  };

  GetAccountAssignmentHistoryLogic = async (accountid, starttime, endtime) => {
    let history = await this.platformSvcI.GetConsoleAccountAssignmentHistory(
      accountid,
      starttime,
      endtime
    );
    if (!history) {
      history = [];
    }
    return history;
  };

  GetFleetUserRoleHistoryLogic = async (accountid, starttime, endtime) => {
    let history = await this.fmsAccountSvcI.GetFleetUserRoleHistory(
      accountid,
      starttime,
      endtime
    );
    if (!history) {
      history = [];
    }
    return history;
  };
}
