import { createClient, createCluster } from "redis";
import FabErr from "./faberr.js";

export const ErrConnect = new FabErr(
  "ERR_CONNECT",
  null,
  "redis connect error"
);
export const ErrGet = new FabErr("ERR_GET", null, "redis get error");
export const ErrSet = new FabErr("ERR_SET", null, "redis set error");
export const ErrDel = new FabErr("ERR_DEL", null, "redis del error");

export default class RedisSvc {
  constructor(redisConfig, logger) {
    this.logger = logger;
    this.client = null;
    this.config = redisConfig || {};
    this.isCluster = this.shouldUseCluster();
  }

  shouldUseCluster() {
    return Boolean(
      this.config?.useCluster === true ||
        this.config?.cluster === true ||
        Array.isArray(this.config?.rootNodes)
    );
  }

  buildStandaloneUrl() {
    const host = this.config?.host || "127.0.0.1";
    const port = this.config?.port || 6379;
    return `redis://${host}:${port}`;
  }

  buildClusterRootNodes() {
    if (Array.isArray(this.config?.rootNodes) && this.config.rootNodes.length) {
      return this.config.rootNodes.map((node) => {
        if (typeof node === "string") {
          return { url: node };
        }

        if (node?.url) {
          return { url: node.url };
        }

        return {
          url: `redis://${node.host}:${node.port}`,
        };
      });
    }

    return [
      {
        url: this.buildStandaloneUrl(),
      },
    ];
  }

  attachEventHandlers() {
    if (!this.client) {
      return;
    }

    this.client.on("error", (err) => {
      this.logger.error(
        this.isCluster ? "Redis Cluster Error:" : "Redis Error:",
        err
      );
    });

    this.client.on("connect", () => {
      this.logger.info(
        this.isCluster ? "Redis Cluster Connected" : "Redis Connected"
      );
    });

    this.client.on("ready", () => {
      this.logger.info(this.isCluster ? "Redis Cluster Ready" : "Redis Ready");
    });
  }

  async connect() {
    try {
      if (!this.client) {
        if (this.isCluster) {
          this.client = createCluster({
            rootNodes: this.buildClusterRootNodes(),
            defaults: {
              socket: {
                connectTimeout: 10000,
              },
            },
          });
        } else {
          this.client = createClient({
            url: this.buildStandaloneUrl(),
            socket: {
              connectTimeout: 10000,
            },
          });
        }

        this.attachEventHandlers();
      }

      if (!this.client.isOpen) {
        await this.client.connect();
      }

      return [true, null];
    } catch (error) {
      this.logger.error(
        this.isCluster
          ? "Redis cluster connection error:"
          : "Redis connection error:",
        error
      );
      return [null, ErrConnect.NewWData(error)];
    }
  }

  async get(key) {
    if (typeof key === "string") {
      return this.getSingle(key);
    } else if (Array.isArray(key)) {
      return this.getList(key);
    } else {
      return [null, ErrGet.NewWData("Invalid key type")];
    }
  }

  async getSingle(key) {
    try {
      if (!this.client) {
        const [, error] = await this.connect();
        if (error) {
          return [null, error];
        }
      }

      const value = await this.client.get(key);
      return [value, null];
    } catch (error) {
      this.logger.error("Redis get error:", error);
      return [null, ErrGet.NewWData(error)];
    }
  }

  async getList(keys) {
    try {
      if (!this.client) {
        const [, error] = await this.connect();
        if (error) {
          return [null, error];
        }
      }

      let values;
      try {
        values = await this.client.mGet(keys);
      } catch (e) {
        values = await Promise.all(keys.map((key) => this.client.get(key)));
      }

      const result = {};
      for (let i = 0; i < keys.length; i++) {
        result[keys[i]] = values[i];
      }

      return [result, null];
    } catch (error) {
      this.logger.error("Redis getList error:", error);
      return [null, ErrGet.NewWData(error)];
    }
  }

  async set(key, value, ttl = null) {
    try {
      if (!this.client) {
        const [, error] = await this.connect();
        if (error) {
          return [null, error];
        }
      }

      const normalizedValue =
        value === null || value === undefined ? "" : String(value);

      let result;
      if (ttl && Number(ttl) > 0) {
        result = await this.client.setEx(key, Number(ttl), normalizedValue);
      } else {
        result = await this.client.set(key, normalizedValue);
      }

      return [result, null];
    } catch (error) {
      this.logger.error("Redis set error:", error);
      return [null, ErrSet.NewWData(error)];
    }
  }

  async del(key) {
    try {
      if (!this.client) {
        const [, error] = await this.connect();
        if (error) {
          return [null, error];
        }
      }

      const result = await this.client.del(key);
      return [result, null];
    } catch (error) {
      this.logger.error("Redis del error:", error);
      return [null, ErrDel.NewWData(error)];
    }
  }

  async publish(channel, message) {
    try {
      if (!this.client) {
        const [, error] = await this.connect();
        if (error) {
          return [null, error];
        }
      }

      const result = await this.client.publish(channel, message);
      return [result, null];
    } catch (error) {
      this.logger.error("Redis publish error:", error);
      return [null, error];
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }
      return [true, null];
    } catch (error) {
      this.logger.error("Redis disconnect error:", error);
      return [null, error];
    }
  }

  async health() {
    try {
      if (!this.client) {
        const [, error] = await this.connect();
        if (error) {
          return [false, error];
        }
      }

      await this.client.ping();
      return [true, null];
    } catch (error) {
      this.logger.error("Redis health check error:", error);
      return [false, error];
    }
  }
}