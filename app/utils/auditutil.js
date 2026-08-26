import { v4 as uuidv4 } from "uuid";

/**
 * Creates an audit wrapper for API handler methods
 * @param {Object} auditSvc - The audit service instance
 * @param {Object} logger - Logger instance
 * @returns {Function} Wrapper function
 */
export function createAuditWrapper(auditSvc, logger) {
  return function auditWrapper(endpoint, originalMethod) {
    return async function (req, res, next) {
      const startTime = Date.now();
      const requestId = uuidv4();

      req.requestId = requestId;

      const requestData = {
        endpoint: endpoint,
        method: req.method,
        requestBody: req.body,
        requestHeaders: req.headers,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get("User-Agent"),
        referer: req.get("Referer"),
        requestId: requestId,
      };

      const originalJson = res.json;
      const originalStatus = res.status;
      let statusCode = 200;
      let responseBody = null;
      let isSuccess = true;
      let errorDetails = null;
      let captchaValidated = false;

      res.status = function (code) {
        statusCode = code;
        isSuccess = code < 400;
        return originalStatus.call(this, code);
      };

      res.json = function (body) {
        responseBody = body;

        if (body && body.errcode) {
          isSuccess = false;
          errorDetails = {
            errcode: body.errcode,
            message: body.message,
            errdata: body.errdata,
          };
        }

        return originalJson.call(this, body);
      };

      try {
        if (req.body && req.body["g-recaptcha-response"]) {
          captchaValidated = true;
        }

        await originalMethod.call(this, req, res, next);
      } catch (error) {
        isSuccess = false;
        statusCode = statusCode || 500;
        errorDetails = {
          error: error.message,
          stack: error?.stack,
        };

        logger.error("API call failed", {
          endpoint: endpoint,
          error: error.message,
          requestId: requestId,
        });

        throw error;
      } finally {
        const processingTime = Date.now() - startTime;
        setImmediate(async () => {
          try {
            await auditSvc.logApiCall({
              endpoint: requestData.endpoint,
              method: requestData.method,
              statusCode: statusCode,
              isSuccess: isSuccess,
              requestBody: requestData.requestBody,
              responseBody: responseBody,
              errorDetails: errorDetails,
              requestHeaders: requestData.requestHeaders,
              ipAddress: requestData.ipAddress,
              userAgent: requestData.userAgent,
              referer: requestData.referer,
              requestId: requestData.requestId,
              processingTimeMs: processingTime,
              captchaValidated: captchaValidated,
            });
          } catch (auditError) {
            logger.error("Failed to log audit data", {
              error: auditError.message,
              endpoint: requestData.endpoint,
              requestId: requestData.requestId,
            });
          }
        });
      }
    };
  };
}

/**
 * Binds audit wrapper to all methods of a handler class
 * @param {Object} handler - The handler instance
 * @param {Object} auditSvc - The audit service instance
 * @param {Object} logger - Logger instance
 * @param {Array} methodsToAudit - Array of method names to audit
 */
export function bindAuditToMethods(handler, auditSvc, logger, methodsToAudit) {
  const wrapper = createAuditWrapper(auditSvc, logger);

  for (const methodName of methodsToAudit) {
    if (typeof handler[methodName] === "function") {
      const originalMethod = handler[methodName];
      const endpoint = `/api/v1/fms/public${getEndpointFromMethod(methodName)}`;

      handler[methodName] = wrapper(endpoint, originalMethod.bind(handler));
    }
  }
}

/**
 * Maps method names to their corresponding endpoints
 * @param {string} methodName - The method name
 * @returns {string} The endpoint path
 */
function getEndpointFromMethod(methodName) {
  const methodEndpointMap = {
    GetSuperAdminToken: "/superadmin/token",
    CheckContact: "/contact/check",
    SignupWithInvite: "/invite/signup",
    ValidateInvite: "/invite/validate",
    UserEmailSignIn: "/email/signin",
    MobileSignIn: "/mobile/signin",
    MobileSendOtp: "/mobile/sendotp",
    ForgotPassword: "/user/forgotpassword",
    ResetPassword: "/user/resetpassword",
    ValidateResetToken: "/user/resetpassword/validate",
    DeleteSession: "/user/session",
  };

  return methodEndpointMap[methodName] || "/unknown";
}
