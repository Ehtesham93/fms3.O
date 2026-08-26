import pg from "pg";
import FabErr from "./faberr.js";

export const ErrConnect = new FabErr("ERR_CONNECT", null, "db connect error");
export const ErrTXNStart = new FabErr("ERR_TXN_START", null, "txn start error");
export const ErrTXNRollback = new FabErr(
  "ERR_TXN_ROLLBACK",
  null,
  "txn rollback error"
);
export const ErrTXNExec = new FabErr("ERR_TXN_EXEC", null, "txn exec error");

export default class PgPool {
  constructor(pgcfg, logger) {
    this.logger = logger;
    this.Pool = new pg.Pool({
      user: pgcfg.user,
      host: pgcfg.host,
      port: pgcfg.port,
      database: pgcfg.database,
      password: pgcfg.password,
      min: 30,
      max: 50,
      statement_timeout: 60 * 1000,
      ssl: false
    });
    this.activeQueries = 0;
    this.Pool.on("connect", (client) => {
      client.query("SET search_path TO " + pgcfg.schema + ",public");
      client.query("SET TIME ZONE 'Asia/Kolkata'");
    });
    this.Pool.on("acquire", (client) => {
      this.activeQueries++;
    });
    this.Pool.on("release", () => {
      this.activeQueries--;
    });
  }

  async Query(...args) {
    return this.Pool.query(...args);
  }

  async StartTransaction() {
    let client = null;
    try {
      client = await this.Pool.connect();
    } catch (error) {
      this.logger.error(error);
      let errorresp = error;
      if (error.hasOwnProperty("message")) errorresp.msg = error.message;
      return [null, ErrConnect.NewWData(error)];
    }
    try {
      await client.query("BEGIN");
      return [client, null];
    } catch (error) {
      if (client) {
        client.release();
      }
      this.logger.error(error);
      let errorresp = error;
      if (error.hasOwnProperty("message")) errorresp.msg = error.message;
      return [null, ErrTXNStart.NewWData(error)];
    }
  }

  async RunTransaction(queryfn) {
    let client = null;
    try {
      client = await this.Pool.connect();
    } catch (error) {
      this.logger.error(error);
      let errorresp = error;
      if (error.hasOwnProperty("message")) errorresp.msg = error.message;
      return [null, ErrConnect.NewWData(error)];
    }
    try {
      await client.query("BEGIN");
      let funcres = await queryfn(client);
      await client.query("COMMIT");
      return funcres;
    } catch (error) {
      let rollbackerr = await this.TxRollback(client);
      if (rollbackerr != null) {
        this.logger.error(rollbackerr);
        let errorresp = rollbackerr;
        if (error.hasOwnProperty("message"))
          errorresp.msg = rollbackerr.message;
        return [null, ErrTXNRollback.NewWData(rollbackerr)];
      }
      this.logger.error(error);
      let errorresp = error;
      if (error.hasOwnProperty("message")) errorresp.msg = error.message;
      return [null, ErrTXNExec.NewWData(errorresp)];
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async TxCommit(client) {
    try {
      await client.query("COMMIT");
      return null;
    } catch (error) {
      return error;
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          this.logger.warn(
            "Client release error during commit:",
            releaseError.message
          );
        }
      }
    }
  }

  async TxRollback(client) {
    try {
      await client.query("ROLLBACK");
      return null;
    } catch (error) {
      return error;
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          this.logger.warn(
            "Client release error during rollback:",
            releaseError.message
          );
        }
      }
    }
  }

  async End() {
    try {
      await this.Pool.end();
    } catch (error) {
      return error;
    }
    return null;
  }
}
