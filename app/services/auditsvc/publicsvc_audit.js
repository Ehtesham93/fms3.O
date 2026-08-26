import { v4 as uuidv4 } from "uuid";

export default class PublicApiAuditSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
  }

  async logApiCall(auditData) {
    try {
      const sanitizedRequestBody = this.sanitizeRequestData(
        auditData.requestBody
      );

      const sanitizedResponseBody = this.sanitizeResponseData(
        auditData.responseBody
      );

      //   const sanitizedHeaders = this.sanitizeHeaders(auditData.requestHeaders);

      const { requestKey, requestValue } = this.extractRequestKeyValue(
        auditData.requestBody,
        auditData.endpoint
      );

      const maxAuditIdQuery = `SELECT COALESCE(MAX(auditid), 0) as max_auditid FROM public_api_audit_log`;
      const maxAuditIdResult = await this.pgPoolI.Query(maxAuditIdQuery);
      const auditid = parseInt(maxAuditIdResult.rows[0].max_auditid) + 1;

      const query = `
        INSERT INTO public_api_audit_log (
          auditid, endpoint, method, statuscode, issuccess, requestkey, requestvalue,
          requestbody, responsebody, errorcode, ipaddress, 
          useragent, referer, requestid, processingtimems, captchavalidated
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING auditid
      `;

      const values = [
        auditid,
        auditData.endpoint,
        auditData.method,
        auditData.statusCode,
        auditData.isSuccess,
        requestKey,
        requestValue,
        sanitizedRequestBody,
        sanitizedResponseBody,
        sanitizedResponseBody?.err?.errcode || null,
        auditData.ipAddress,
        auditData.userAgent,
        auditData.referer,
        auditData.requestId,
        auditData.processingTimeMs,
        auditData.captchaValidated || false,
      ];

      const result = await this.pgPoolI.Query(query, values);

      this.logger.info(
        `API audit logged: ${auditData.endpoint} - ${requestKey}:${requestValue}`,
        {
          auditId: result.rows[0].auditid,
          endpoint: auditData.endpoint,
          requestKey: requestKey,
          success: auditData.isSuccess,
        }
      );

      return result.rows[0].auditid;
    } catch (error) {
      this.logger.error("Failed to log API audit", {
        error: error.toString(),
        endpoint: auditData.endpoint,
        method: auditData.method,
      });
      return null;
    }
  }

  extractRequestKeyValue(requestBody, endpoint) {
    if (!requestBody) return { requestKey: null, requestValue: null };

    const endpointKeyMap = {
      "/superadmin/token": { key: "email", field: "email" },
      "/contact/check": { key: "contact", field: "contact" },
      "/invite/signup": { key: "inviteid", field: "inviteid" },
      "/invite/validate": { key: "inviteid", field: "inviteid" },
      "/email/signin": { key: "email", field: "email" },
      "/mobile/signin": { key: "mobile", field: "mobile" },
      "/mobile/sendotp": { key: "mobile", field: "mobile" },
      "/user/forgotpassword": { key: "email", field: "email" },
      "/user/resetpassword": { key: "resetid", field: "resetid" },
      "/user/resetpassword/validate": { key: "resetid", field: "resetid" },
      "/user/password/change": { key: "email", field: "email" },
    };

    const cleanEndpoint = endpoint.replace("/api/v1/fms/public", "");
    const mapping = endpointKeyMap[cleanEndpoint];

    if (mapping && requestBody[mapping.field]) {
      return {
        requestKey: mapping.key,
        requestValue: requestBody[mapping.field].toString(),
      };
    }

    return { requestKey: null, requestValue: null };
  }

  sanitizeRequestData(requestBody) {
    if (!requestBody) return null;

    const sanitized = { ...requestBody };

    if (sanitized.password) {
      sanitized.password = this.hashSensitiveField(sanitized.password);
    }
    if (sanitized.newpassword) {
      sanitized.newpassword = this.hashSensitiveField(sanitized.newpassword);
    }
    if (sanitized.otp) {
      sanitized.otp = this.hashSensitiveField(sanitized.otp.toString());
    }

    const fieldsToMask = ["g-recaptcha-response"];

    for (const field of fieldsToMask) {
      if (sanitized[field]) {
        sanitized[field] = "***MASKED***";
      }
    }

    return sanitized;
  }

  sanitizeResponseData(responseBody) {
    if (!responseBody) return null;

    const sanitized = { ...responseBody };

    const sensitiveFields = ["usertoken", "token", "secret"];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = "***MASKED***";
      }
    }

    if (sanitized.data && typeof sanitized.data === "object") {
      for (const field of sensitiveFields) {
        if (sanitized.data[field]) {
          sanitized.data[field] = "***MASKED***";
        }
      }
    }

    return sanitized;
  }

  sanitizeHeaders(headers) {
    if (!headers) return null;

    const sanitized = { ...headers };

    const sensitiveHeaders = [
      "authorization",
      "cookie",
      "x-api-key",
      "x-auth-token",
      "x-access-token",
      "bearer",
    ];

    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = "***MASKED***";
      }
      if (sanitized[header.toLowerCase()]) {
        sanitized[header.toLowerCase()] = "***MASKED***";
      }
    }

    return sanitized;
  }

  hashSensitiveField(value) {
    if (!value || typeof value !== "string") return value;

    const length = value.length;

    if (length <= 2) {
      return value[0] + "#".repeat(length - 1);
    } else if (length <= 4) {
      return value[0] + "#".repeat(length - 2) + value[length - 1];
    } else if (length <= 8) {
      const mid = Math.floor(length / 2);
      return (
        value[0] +
        "#".repeat(mid - 1) +
        value[mid] +
        "#".repeat(length - mid - 2) +
        value[length - 1]
      );
    } else {
      return (
        value.substring(0, 2) +
        "#".repeat(length - 4) +
        value.substring(length - 2)
      );
    }
  }

  async getUserActivity(requestKey, requestValue, hours = 24) {
    try {
      const query = `
        SELECT 
          endpoint,
          method,
          statuscode,
          issuccess,
          ipaddress,
          createdat,
          processingtimems
        FROM public_api_audit_log 
        WHERE requestkey = $1 AND requestvalue = $2
          AND createdat >= NOW() - INTERVAL '${hours} hours'
        ORDER BY createdat DESC
      `;

      const result = await this.pgPoolI.Query(query, [
        requestKey,
        requestValue,
      ]);
      return result.rows;
    } catch (error) {
      this.logger.error("Failed to get user activity", error);
      throw error;
    }
  }

  async getRequestsByType(requestKey, hours = 24, limit = 100) {
    try {
      const query = `
        SELECT 
          requestvalue,
          COUNT(*) as total_requests,
          COUNT(CASE WHEN issuccess = true THEN 1 END) as successful_requests,
          COUNT(CASE WHEN issuccess = false THEN 1 END) as failed_requests,
          COUNT(DISTINCT ipaddress) as unique_ips,
          MAX(createdat) as last_activity
        FROM public_api_audit_log 
        WHERE requestkey = $1
          AND createdat >= NOW() - INTERVAL '${hours} hours'
        GROUP BY requestvalue
        ORDER BY total_requests DESC
        LIMIT $2
      `;

      const result = await this.pgPoolI.Query(query, [requestKey, limit]);
      return result.rows;
    } catch (error) {
      this.logger.error("Failed to get requests by type", error);
      throw error;
    }
  }

  async getSuspiciousActivity(hours = 1, minFailedAttempts = 5) {
    try {
      const query = `
        SELECT 
          requestkey,
          requestvalue,
          ipaddress,
          COUNT(*) as total_attempts,
          COUNT(CASE WHEN issuccess = false THEN 1 END) as failed_attempts,
          COUNT(DISTINCT endpoint) as unique_endpoints,
          MIN(createdat) as first_attempt,
          MAX(createdat) as last_attempt
        FROM public_api_audit_log 
        WHERE createdat >= NOW() - INTERVAL '${hours} hours'
          AND requestkey IS NOT NULL
        GROUP BY requestkey, requestvalue, ipaddress
        HAVING COUNT(CASE WHEN issuccess = false THEN 1 END) >= $1
        ORDER BY failed_attempts DESC
      `;

      const result = await this.pgPoolI.Query(query, [minFailedAttempts]);
      return result.rows;
    } catch (error) {
      this.logger.error("Failed to get suspicious activity", error);
      throw error;
    }
  }
}
