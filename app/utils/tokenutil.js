import { APIResponseBadRequest } from "./responseutil.js";
import { GetUnVerifiedClaims } from "./jwtutil.js";

export const AuthenticateUserTokenFromCookie = async (req, res, next) => {
  try {
    let token = req.headers["Cookie"] || req.headers["cookie"];
    if (!token) {
      APIResponseBadRequest(
        req,
        res,
        "TOKEN_REQUIRED",
        {},
        "Token is required"
      );
      return;
    }

    // handle multiple cookies
    if (token.includes(";")) {
      let cookies = token.split(";");
      for (let eachcookie of cookies) {
        eachcookie = eachcookie.trim();
        if (eachcookie.startsWith("token=")) {
          token = eachcookie.substring(6);
          break;
        }
      }
    }

    if (token.startsWith("token=")) {
      token = token.substring(6);
    }

    let claims = await GetUnVerifiedClaims(token);
    if (!claims) {
      APIResponseBadRequest(req, res, "INVALID_TOKEN", {}, "Invalid token");
      return;
    }

    if (!claims.userid) {
      APIResponseBadRequest(
        req,
        res,
        "INVALID_TOKEN",
        {},
        "User ID is missing in token"
      );
      return;
    }

    req.userid = claims.userid;

    res.set({
      "Cache-Control": "no-store", // Stronger than no-cache
      Pragma: "no-cache",
      Expires: "0",
    });
    res.removeHeader("ETag");

    next();
  } catch (error) {
    this.logger.error("User token authentication failed", error);
    APIResponseBadRequest(
      req,
      res,
      "INVALID_TOKEN",
      {},
      "User token validation failed"
    );
  }
};

export const AuthenticateAccountTokenFromCookie = async (req, res, next) => {
  try {
    let token = req.headers["Cookie"] || req.headers["cookie"];
    if (!token) {
      APIResponseBadRequest(
        req,
        res,
        "TOKEN_REQUIRED",
        {},
        "Token is required"
      );
      return;
    }

    // handle multiple cookies
    if (token.includes(";")) {
      let cookies = token.split(";");
      for (let eachcookie of cookies) {
        eachcookie = eachcookie.trim();
        if (eachcookie.startsWith("token=")) {
          token = eachcookie.substring(6);
          break;
        }
      }
    }

    if (token.startsWith("token=")) {
      token = token.substring(6);
    }

    let claims = await GetUnVerifiedClaims(token);
    if (!claims) {
      APIResponseBadRequest(req, res, "INVALID_TOKEN", {}, "Invalid token");
      return;
    }

    if (!claims.userid) {
      APIResponseBadRequest(
        req,
        res,
        "INVALID_TOKEN",
        {},
        "User ID is missing in token"
      );
      return;
    }

    if (!claims.accountid) {
      APIResponseBadRequest(
        req,
        res,
        "INVALID_TOKEN",
        {},
        "Account ID is missing in token"
      );
      return;
    }

    req.userid = claims.userid;
    req.accountid = claims.accountid;

    res.set({
      "Cache-Control": "no-store", // Stronger than no-cache
      Pragma: "no-cache",
      Expires: "0",
    });
    res.removeHeader("ETag");

    next();
  } catch (error) {
    this.logger.error("Account token authentication failed", error);
    APIResponseBadRequest(
      req,
      res,
      "INVALID_TOKEN",
      {},
      "Account token validation failed"
    );
  }
};

export const AuthenticateUserToken = async (req, res, next) => {
  try {
    let token = req.headers["Authorization"] || req.headers["authorization"];
    if (!token) {
      APIResponseBadRequest(
        req,
        res,
        "TOKEN_REQUIRED",
        {},
        "Token is required"
      );
      return;
    }

    if (token.startsWith("Bearer ")) {
      token = token.substring(7);
    }

    let claims = await GetUnVerifiedClaims(token);
    if (!claims) {
      APIResponseBadRequest(req, res, "INVALID_TOKEN", {}, "Invalid token");
      return;
    }

    if (!claims.userid) {
      APIResponseBadRequest(
        req,
        res,
        "INVALID_TOKEN",
        {},
        "User ID is missing in token"
      );
      return;
    }

    req.userid = claims.userid;

    res.set({
      "Cache-Control": "no-store", // Stronger than no-cache
      Pragma: "no-cache",
      Expires: "0",
    });
    res.removeHeader("ETag");

    next();
  } catch (error) {
    this.logger.error("User token authentication failed", error);
    APIResponseBadRequest(
      req,
      res,
      "INVALID_TOKEN",
      {},
      "User token validation failed"
    );
  }
};

export const AuthenticateAccountToken = async (req, res, next) => {
  try {
    let token = req.headers["Authorization"] || req.headers["authorization"];
    if (!token) {
      APIResponseBadRequest(
        req,
        res,
        "TOKEN_REQUIRED",
        {},
        "Token is required"
      );
      return;
    }

    if (token.startsWith("Bearer ")) {
      token = token.substring(7);
    }

    let claims = await GetUnVerifiedClaims(token);
    if (!claims) {
      APIResponseBadRequest(req, res, "INVALID_TOKEN", {}, "Invalid token");
      return;
    }

    if (!claims.userid) {
      APIResponseBadRequest(
        req,
        res,
        "INVALID_TOKEN",
        {},
        "User ID is missing in token"
      );
      return;
    }

    if (!claims.accountid) {
      APIResponseBadRequest(
        req,
        res,
        "INVALID_TOKEN",
        {},
        "Account ID is missing in token"
      );
      return;
    }

    req.userid = claims.userid;
    req.accountid = claims.accountid;

    res.set({
      "Cache-Control": "no-store", // Stronger than no-cache
      Pragma: "no-cache",
      Expires: "0",
    });
    res.removeHeader("ETag");

    next();
  } catch (error) {
    this.logger.error("Account token authentication failed", error);
    APIResponseBadRequest(
      req,
      res,
      "INVALID_TOKEN",
      {},
      "Account token validation failed"
    );
  }
};
