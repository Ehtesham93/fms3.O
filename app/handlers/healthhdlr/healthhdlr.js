import {
  APIResponseBadRequest,
  APIResponseError,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../utils/responseutil.js";

export default class HealthHdlr {
  constructor(healthSvcI) {
    this.healthSvcI = healthSvcI;
  }

  GetHealthStatus = async (req, res, next) => {
    try {
      console.log("Called GetHealthStatus");
      let healthStatus = this.healthSvcI.GetHealthStatus();
      console.log("healthStatus", healthStatus);
      APIResponseOK(req, res, healthStatus, "Health Status Ready!");
    } catch (e) {
      APIResponseInternalErr(
        req,
        res,
        "HEALTH_STATUS_ERR",
        e.toString(),
        "health status query failed"
      );
    }
  };

  RegisterRoutes(router) {
    router.get("/check", this.GetHealthStatus);
  }
}
