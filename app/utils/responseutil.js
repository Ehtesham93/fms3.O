// API Response structure...
export function apiresponseerror(errcode, errdata) {
  return {
    errcode: errcode,
    errdata: errdata,
  };
}

export function apiresponse(err, data, msg) {
  return {
    err: err,
    data: data,
    msg: msg,
  };
}

export function APIResponseOK(req, res, data, msg) {
  res.status(200).send(apiresponse(null, data, msg));
}

export function APIResponseError(req, res, statuscode, errcode, errdata, msg) {
  return res
    .status(statuscode)
    .send(apiresponse(apiresponseerror(errcode, null), null, msg));
}

export function APIResponseBadRequest(req, res, errcode, errdata, msg) {
  return APIResponseError(req, res, 400, errcode, errdata, msg);
}

export function APIResponseUnauthorized(req, res, errcode, errdata, msg) {
  return APIResponseError(req, res, 401, errcode, errdata, msg);
}

export function APIResponseForbidden(req, res, errcode, errdata, msg) {
  return APIResponseError(req, res, 403, errcode, errdata, msg);
}

export function APIResponseInternalErr(req, res, errcode, errdata, msg) {
  return APIResponseError(req, res, 500, "INTERNAL_SERVER_ERROR", null, msg);
}
