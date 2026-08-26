import { APIResponseUnauthorized } from "./responseutil.js";

/**
 * Checks if user has the required console permission(s)
 * @param {string[]} userPermissions - Array of permissions assigned to the user (from req.userperms)
 * @param {string[]} requiredPermissions - Array of required permissions to check
 * @param {string} mode - 'any' or 'all' (default: 'any')
 * @returns {boolean} - true if user has required permissions, false otherwise
 */
export function CheckUserPerms(
  userPermissions,
  requiredPermissions,
  mode = "any"
) {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }

  if (userPermissions.includes("all.all.all")) {
    return true;
  }

  if (
    !requiredPermissions ||
    !Array.isArray(requiredPermissions) ||
    requiredPermissions.length === 0
  ) {
    return false;
  }

  if (mode === "all") {
    return requiredPermissions.every((perm) => userPermissions.includes(perm));
  } else {
    return requiredPermissions.some((perm) => userPermissions.includes(perm));
  }
}

export const CheckUserStatusMiddleware = (userSvcI, logger) => {
  return async (req, res, next) => {
    try {
      const userid = req.userid;

      if (!userid) {
        APIResponseUnauthorized(
          req,
          res,
          "USER_ID_MISSING",
          {},
          "User ID is required"
        );
        return;
      }

      const userDetails = await userSvcI.GetUserDetails(userid);

      if (!userDetails) {
        APIResponseUnauthorized(
          req,
          res,
          "USER_NOT_FOUND",
          {},
          "User not found"
        );
        return;
      }

      if (userDetails.isdeleted) {
        APIResponseUnauthorized(
          req,
          res,
          "USER_DELETED",
          {},
          "User account has been deleted"
        );
        return;
      }

      if (!userDetails.isenabled) {
        APIResponseUnauthorized(
          req,
          res,
          "USER_DISABLED",
          {},
          "User account is disabled"
        );
        return;
      }

      req.userDetails = userDetails;
      next();
    } catch (error) {
      logger.error("CheckUserStatusMiddleware error: ", error);
      APIResponseUnauthorized(
        req,
        res,
        "USER_STATUS_CHECK_FAILED",
        {},
        "Failed to verify user status"
      );
    }
  };
};
