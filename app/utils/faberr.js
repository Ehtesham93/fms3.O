export default class FabErr {
  constructor(errcode, errdata, errmsg) {
    this.errcode = errcode;
    this.errdata = errdata;
    this.errmsg = errmsg;
  }

  NewWData(newdata) {
    return new FabErr(this.errcode, newdata, this.errmsg);
  }
}
