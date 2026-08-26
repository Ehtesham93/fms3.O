import AuthSvcClient from "./authsvc_client.js";

export default class AuthSvc {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.authSvcClient = new AuthSvcClient(config, logger);
  }

  CreateConsumer(userid) {
    return this.authSvcClient.createConsumer(userid);
  }

  GetUserToken(userid, validity) {
    return this.authSvcClient.getUserToken(userid, validity);
  }

  GetAccountToken(userid, accountid, validity) {
    return this.authSvcClient.getAccountToken(userid, accountid, validity);
  }

  InvalidateToken(userid) {
    return this.authSvcClient.invalidateToken(userid);
  }

  DeleteConsumer(userid) {
    return this.authSvcClient.deleteConsumer(userid);
  }

  GetToken(userid, tokenclaims) {
    return this.authSvcClient.getToken(userid, tokenclaims);
  }

  GetTokenAndRefreshToken(userid, tokenclaims, refreshtokenclaims) {
    return this.authSvcClient.getTokenAndRefreshToken(
      userid,
      tokenclaims,
      refreshtokenclaims
    );
  }
}
