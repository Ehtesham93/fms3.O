import axios from "axios";

export default class AuthSvcClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async createConsumer(userid) {
    let url = `${this.config.authsvc.url}${this.config.authsvc.createConsumerPath}`;
    let body = {
      userid: userid,
    };
    try {
      let res = await axios.put(url, body);
      return res.data.data;
    } catch (err) {
      this.logger.error(`Error creating consumer for user ${userid}`, err);
      throw err;
    }
  }

  async getUserToken(userid, validity) {
    let url = `${this.config.authsvc.url}${this.config.authsvc.getUserTokenPath}`;
    let body = {
      userid: userid,
      validity: validity,
    };
    try {
      let res = await axios.post(url, body);
      return res.data.data;
    } catch (err) {
      this.logger.error(`Error getting user token for user ${userid}`, err);
      throw err;
    }
  }

  async getAccountToken(userid, accountid, validity) {
    let url = `${this.config.authsvc.url}${this.config.authsvc.getAccountTokenPath}`;
    let body = {
      userid: userid,
      accountid: accountid,
      validity: validity,
    };
    try {
      let res = await axios.post(url, body);
      return res.data.data;
    } catch (err) {
      this.logger.error(
        `Error getting account token for user ${userid} and account ${accountid}`,
        err
      );
      throw err;
    }
  }

  async invalidateToken(userid) {
    let url = `${this.config.authsvc.url}${this.config.authsvc.invalidateTokenPath}`;
    let body = {
      userid: userid,
    };
    try {
      let res = await axios.post(url, body);
      return res.data.data;
    } catch (err) {
      this.logger.error(`Error invalidating token for user ${userid}`, err);
      throw err;
    }
  }

  async deleteConsumer(userid) {
    // TODO: path of create consumer and delete consumer is same
    let url = `${this.config.authsvc.url}${this.config.authsvc.createConsumerPath}`;
    let body = {
      userid: userid,
    };
    try {
      let res = await axios.delete(url, { data: body });
      return res.data.data;
    } catch (err) {
      this.logger.error(`Error deleting consumer for user ${userid}`, err);
      throw err;
    }
  }

  async getToken(userid, tokenclaims) {
    let url = `${this.config.authsvc.url}${this.config.authsvc.getTokenPath}`;
    let body = {
      userid: userid,
      token: tokenclaims,
    };
    try {
      let res = await axios.post(url, body);
      return res.data.data;
    } catch (err) {
      this.logger.error(`Error getting token for user ${userid}`, err);
      throw err;
    }
  }

  async getTokenAndRefreshToken(userid, tokenclaims, refreshtokenclaims) {
    let url = `${this.config.authsvc.url}${this.config.authsvc.getTokenPath}`;
    let body = {
      userid: userid,
      token: tokenclaims,
      refreshtoken: refreshtokenclaims,
    };
    try {
      let res = await axios.post(url, body);
      return res.data.data;
    } catch (err) {
      this.logger.error(
        `Error getting token and refresh token for user ${userid}`,
        err
      );
      throw err;
    }
  }
}
