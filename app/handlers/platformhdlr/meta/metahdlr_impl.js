export default class MetaHdlrImpl {
  constructor(metaSvcI, logger) {
    this.metaSvcI = metaSvcI;
    this.logger = logger;
  }

  // vehicle city
  CreateVehicleCityLogic = async (cityname) => {
    return await this.metaSvcI.CreateVehicleCity(cityname);
  };

  IsCityCodeAvailableLogic = async (citycode) => {
    return await this.metaSvcI.IsCityCodeAvailable(citycode);
  };

  UpdateVehicleCityLogic = async (citycode, cityname) => {
    return await this.metaSvcI.UpdateVehicleCity(citycode, cityname);
  };

  DeleteVehicleCityLogic = async (citycode) => {
    return await this.metaSvcI.DeleteVehicleCity(citycode);
  };

  // vehicle dealer
  CreateVehicleDealerLogic = async (dealername) => {
    return await this.metaSvcI.CreateVehicleDealer(dealername);
  };

  IsDealerCodeAvailableLogic = async (dealercode) => {
    return await this.metaSvcI.IsDealerCodeAvailable(dealercode);
  };

  UpdateVehicleDealerLogic = async (dealercode, dealername) => {
    return await this.metaSvcI.UpdateVehicleDealer(dealercode, dealername);
  };

  DeleteVehicleDealerLogic = async (dealercode) => {
    return await this.metaSvcI.DeleteVehicleDealer(dealercode);
  };

  // vehicle color
  CreateVehicleColorLogic = async (colorname) => {
    return await this.metaSvcI.CreateVehicleColor(colorname);
  };

  IsColorCodeAvailableLogic = async (colorcode) => {
    return await this.metaSvcI.IsColorCodeAvailable(colorcode);
  };

  UpdateVehicleColorLogic = async (colorcode, colorname) => {
    return await this.metaSvcI.UpdateVehicleColor(colorcode, colorname);
  };

  DeleteVehicleColorLogic = async (colorcode) => {
    return await this.metaSvcI.DeleteVehicleColor(colorcode);
  };

  IsColorNameAvailableLogic = async (colorname) => {
    return await this.metaSvcI.IsColorNameAvailable(colorname);
  };
  IsDealerNameAvailableLogic = async (dealername) => {
    return await this.metaSvcI.IsDealerNameAvailable(dealername);
  };
  IsCityNameAvailableLogic = async (cityname) => {
    return await this.metaSvcI.IsCityNameAvailable(cityname);
  };
}
