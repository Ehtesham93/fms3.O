export async function Sleep(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

export function IsNil(input) {
  if (input === undefined || input === null) return true;
  return false;
}

// input intcar.intellicar.io
// output intcar
export function getBaseHostName(hostname) {
  if (hostname === null) {
    return null;
  }

  let tokens = hostname.split(".");
  if (tokens.length > 0) {
    return tokens[0];
  }

  return null;
}

// input intcar.intellicar.io:11891
// output intcar.intellicar.io
export function getHostName(hostname) {
  if (hostname === null) {
    return null;
  }

  let tokens = hostname.split(":");
  if (tokens.length > 0) {
    return tokens[0];
  }

  return null;
}

export function GetTokenFromHeader(headers) {
  let authheader = headers.authorization;

  if (authheader === undefined || authheader === null) {
    return null;
  }

  if (authheader.indexOf("Bearer ") != -1) {
    authheader = authheader.substring(
      authheader.indexOf("Bearer ") + 7,
      authheader.length
    );
  }

  return authheader;
}

export function ValidateModuleCode(modulecode) {
  if (modulecode === null || modulecode === undefined) {
    return false;
  }
  if (!/^[a-zA-Z0-9]+$/.test(modulecode)) {
    return false;
  }
  return true;
}

export function ValidatePermissionId(permissionid) {
  if (permissionid === null || permissionid === undefined) {
    return false;
  }
  let parts = permissionid.split(".");
  if (parts.length !== 3) {
    return false;
  }
  // if permissionid is not alphanumeric, return false
  if (
    !/^[a-zA-Z0-9]+$/.test(parts[0]) ||
    !/^[a-zA-Z0-9]+$/.test(parts[1]) ||
    !/^[a-zA-Z0-9]+$/.test(parts[2])
  ) {
    return false;
  }
  return true;
}

export function GetRoleNameFromId(invitesinfo, roledetails, accountid) {
  let listofrolename = [];

  if (invitesinfo.roleids) {
    for (let i = 0; i < invitesinfo.roleids.length; i++) {
      let roleid = invitesinfo.roleids[i];
      let role = roledetails.find((role) => role.roleid === roleid);

      let rolename = "Unknown";

      if (role) {
        if (role.roleid === "ffffffff-ffff-ffff-ffff-ffffffffffff") {
          rolename =
            accountid === "ffffffff-ffff-ffff-ffff-ffffffffffff"
              ? "Super Admin"
              : "Admin";
        } else {
          rolename = role.rolename;
        }
      }

      listofrolename.push(rolename);
    }

    delete invitesinfo.roleids;
    invitesinfo.roles = listofrolename;
  }
}

export function EmailMobileValidation(accountinfo) {
  if (
    (accountinfo &&
      accountinfo.emailList &&
      !Array.isArray(accountinfo.emailList)) ||
    (accountinfo &&
      accountinfo.mobileList &&
      !Array.isArray(accountinfo.mobileList))
  ) {
    return {
      isvalid: false,
      message: "Invalid list, please provide array of emails or mobile numbers",
    };
  }

  if (
    (accountinfo &&
      accountinfo.emailList &&
      accountinfo.emailList.length > 11) ||
    (accountinfo &&
      accountinfo.mobileList &&
      accountinfo.mobileList.length > 11)
  ) {
    return {
      isvalid: false,
      message: "Email or Mobile list should not be more than 11",
    };
  }

  return { isvalid: true };
}

export function getLoggableRequest(req) {
  return {
    userid: req.userid || "Unknown User",
    method: req.method,
    url: req.url,
    query: req.query,
    headers: req.headers,
    body: req.body,
    userAgent: req.get("User-Agent"),
    referrer: req.get("Referrer"),
    ip: req.ip,
  };
}

export function addPaginationToQuery(
  query,
  offset,
  limit,
  existingParams = []
) {
  if (limit < 0 || limit > 1000) {
    const error = new Error("Limit must be between 0 and 1000");
    error.errcode = "INPUT_ERROR";
    throw error;
  }
  const paramOffset = existingParams.length + 1;
  const paramLimit = existingParams.length + 2;

  const modifiedQuery = `${query.trim()} OFFSET $${paramOffset} LIMIT $${paramLimit}`;
  const params = [...existingParams, offset, limit];

  return {
    query: modifiedQuery,
    params: params,
  };
}

export function parseQueryInt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = parseInt(value);
  return isNaN(parsed) ? undefined : parsed;
}

export function preprocessingText(name) {
  if (!name || typeof name !== "string") {
    return ""; // Return empty string for undefined, null, or non-string values
  }
  return name
    .toUpperCase() // Convert to uppercase
    .replace(/[^A-Z0-9_\s]/g, " ") // Replace anything other than alphabets, numbers, and spaces with space
    .replace(/\s+/g, " ") // Replace multiple whitespaces with single space
    .trim(); // Trim leading and trailing whitespaces
}
