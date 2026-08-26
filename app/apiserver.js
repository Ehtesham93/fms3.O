import {
  APIResponseError,
  APIResponseForbidden,
} from "./utils/responseutil.js";
import promiserouter from "express-promise-router";
import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import morgan from "morgan";
import requestIp from "request-ip";
import cors from "cors";
import cookieParser from "cookie-parser";

export default class APIServer {
  constructor(publicroutehandlers, apiroutehandlers, config, logger) {
    this.publicroutehandlers = publicroutehandlers;
    this.apiroutehandlers = apiroutehandlers;
    this.logger = logger;
    this.config = config;
    this.app = this.#getexpressapp();
  }

  Start(port) {
    for (let eachhandler of this.publicroutehandlers) {
      let newrouter = promiserouter();
      eachhandler[1].RegisterRoutes(newrouter);
      this.app.use(eachhandler[0], newrouter);
    }

    this.app.use(cookieParser());

    for (let eachhandler of this.apiroutehandlers) {
      let newrouter = promiserouter();
      eachhandler[1].RegisterRoutes(newrouter);
      this.app.use(eachhandler[0], newrouter);
    }

    this.app.use((req, res, next) => this.#errornotfound(req, res, next));
    this.app.use((err, req, res, next) =>
      this.#errorhandler(err, req, res, next)
    );

    this.app.listen(port, () => {
      this.logger.info("App listening on port:" + port);
    });
  }

  // # Private functions...
  #getexpressapp() {
    let app = express();
    // app.set('trust proxy', true);
    app.use(compression());
    app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
    app.use(bodyParser.json({ type: "application/*+json", limit: "50mb" }));
    app.use(bodyParser.json());
    app.use(bodyParser.raw({ type: "application/vnd.custom-type" }));
    app.use(
      morgan(
        ":remote-addr :method :url :status :res[content-length] - :response-time ms",
        { stream: { write: (x) => this.logger.info(x) } }
      )
    );

    const allowLocalhost = function (origin, callback) {
      // List of allowed origins (can include specific ports or use regex for localhost)
      const allowedOrigins = [
        /^https:\/\/localhost:\d+$/, // any port on localhost
        /^https:\/\/.*\.mahindralastmilemobility\.com(:\d+)?$/, // optional :port
      ];

      if (!origin) return callback(null, true); // allow non-browser requests like curl or Postman

      const isAllowed = allowedOrigins.some((pattern) => pattern.test(origin));
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    };

    app.use(
      cors({
        origin: allowLocalhost,
        credentials: true, // allow sending cookies
      })
    );
    app.use(requestIp.mw());
    return app;
  }

  #errornotfound(req, res, next) {
    this.logger.error("No route found: ", { path: req.path });
    // If we have reached here, we will throw an error..
    APIResponseForbidden(
      req,
      res,
      "FORBIDDEN_API",
      { path: req.path },
      "non-existing path"
    );
  }

  #errorhandler(err, req, res, next) {
    this.logger.error("APIServer Error: ", { error: err });
    let errstr = JSON.stringify(err);

    if ("toString" in err) {
      errstr = err.toString();
    }

    APIResponseError(
      req,
      res,
      500,
      "INTERNAL_SERVER_ERROR",
      errstr,
      "internal server error"
    );
  }
}
