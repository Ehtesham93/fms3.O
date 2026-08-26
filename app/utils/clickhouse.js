import { createClient } from "@clickhouse/client";
import config from "../config/config.js";

export default class ClickHouseClient {
  constructor() {
    this.urls = config.clickhouse.urls;
    this.currentUrlIndex = 0;
    this.client = null;
    this.connectionConfig = {
      username: config.clickhouse.username,
      password: config.clickhouse.password,
      database: config.clickhouse.database,
      maxBatchDataSize: config.clickhouse.maxBatchDataSize,
      maxParallelRequests: config.clickhouse.maxParallelRequests,
      compression: config.clickhouse.compression,
      keep_alive: config.clickhouse.keep_alive,
    };
    this.initializeClient();
  }

  initializeClient() {
    this.client = createClient({
      url: this.urls[this.currentUrlIndex],
      ...this.connectionConfig,
    });
  }

  async tryNextConnection() {
    this.currentUrlIndex = (this.currentUrlIndex + 1) % this.urls.length;
    this.initializeClient();
  }

  async executeWithFailover(operation) {
    let lastError;
    const maxAttempts = this.urls.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(
          `Connection failed to ${
            this.urls[this.currentUrlIndex]
          }, trying next...`
        );
        await this.tryNextConnection();
      }
    }

    throw lastError;
  }

  async query(queryCh, params = {}) {
    try {
      return await this.executeWithFailover(async () => {
        const response = await this.client.query({
          query: queryCh,
          format: "JSONEachRow",
          query_params: params,
        });

        const results = await response.json();
        return {
          success: true,
          data: results,
          message: "Query Success",
        };
      });
    } catch (error) {
      return {
        success: false,
        error: error,
        message: "Query failed",
      };
    }
  }

  async queryWithCallback(queryCh, callback) {
    const result = await this.query(queryCh);

    if (callback && typeof callback === "function") {
      if (result.success) {
        callback(null, result.data, result.message);
      } else {
        callback(result.error, null, result.message);
      }
    }

    return result;
  }

  async close() {
    try {
      await this.client.close();
      return {
        success: true,
        message: "Connection closed successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: error,
        message: "Failed to close connection",
      };
    }
  }

  async checkConnection() {
    try {
      return await this.executeWithFailover(async () => {
        const response = await this.client.query({
          query: "SELECT 1",
          format: "JSONEachRow",
        });

        await response.json();
        return {
          success: true,
          message: "Successfully connected to ClickHouse",
          isConnected: true,
        };
      });
    } catch (error) {
      return {
        success: false,
        error: error,
        message: "Failed to connect to ClickHouse",
        isConnected: false,
      };
    }
  }
}
