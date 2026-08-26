export default class ModelHdlrImpl {
  constructor(modelSvcI, userSvcI, logger) {
    this.modelSvcI = modelSvcI;
    this.userSvcI = userSvcI;
    this.logger = logger;
  }

  // param family CRUD
  CreateParamFamilyLogic = async (
    paramfamilycode,
    paramfamilyname,
    paramfamilyinfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcI.CreateParamFamily(
      paramfamilycode,
      paramfamilyname,
      paramfamilyinfo,
      isenabled,
      createdby
    );
  };

  ListParamFamiliesLogic = async () => {
    return await this.modelSvcI.ListParamFamilies();
  };

  UpdateParamFamilyLogic = async (paramfamilycode, updateFields, updatedby) => {
    let allowedFields = ["paramfamilyname", "paramfamilyinfo", "isenabled"];

    let filteredFields = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        filteredFields[key] = value;
      }
    }

    if (Object.keys(filteredFields).length === 0) {
      throw new Error("No valid fields provided for update");
    }
    let res = await this.modelSvcI.UpdateParamFamily(
      paramfamilycode,
      filteredFields,
      updatedby
    );

    if (!res) {
      throw new Error("Failed to update param family");
    }

    return {
      paramfamilycode,
      ...filteredFields,
      updatedby: updatedby,
    };
  };

  DeleteParamFamilyLogic = async (paramfamilycode, deletedby) => {
    return await this.modelSvcI.DeleteParamFamily(paramfamilycode, deletedby);
  };

  IsParamFamilyCodeAvailableLogic = async (paramfamilycode) => {
    return await this.modelSvcI.IsParamFamilyCodeAvailable(paramfamilycode);
  };

  // model param CRUD
  CreateModelParamLogic = async (
    paramfamilycode,
    paramcode,
    paramname,
    paraminfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcI.CreateModelParam(
      paramfamilycode,
      paramcode,
      paramname,
      paraminfo,
      isenabled,
      createdby
    );
  };

  ListModelParamsLogic = async () => {
    return await this.modelSvcI.ListModelParams();
  };

  ListModelParamsByFamilyLogic = async (paramfamilycode) => {
    return await this.modelSvcI.ListModelParamsByFamily(paramfamilycode);
  };

  UpdateModelParamLogic = async (
    paramfamilycode,
    paramcode,
    updateFields,
    updatedby
  ) => {
    const allowedFields = ["paramname", "paraminfo", "isenabled"];

    const filteredFields = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        filteredFields[key] = value;
      }
    }

    if (Object.keys(filteredFields).length === 0) {
      throw new Error("No valid fields provided for update");
    }

    const res = await this.modelSvcI.UpdateModelParam(
      paramfamilycode,
      paramcode,
      filteredFields,
      updatedby
    );

    if (!res) {
      this.logger.error("Failed to update model param");
      throw new Error("Failed to update model param");
    }

    return res;
  };

  DeleteModelParamLogic = async (paramfamilycode, paramcode, deletedby) => {
    return await this.modelSvcI.DeleteModelParam(
      paramfamilycode,
      paramcode,
      deletedby
    );
  };

  IsParamCodeAvailableLogic = async (paramfamilycode, paramcode) => {
    return await this.modelSvcI.IsParamCodeAvailable(
      paramfamilycode,
      paramcode
    );
  };

  // family CRUD

  CreateModelFamilyLogic = async (
    familycode,
    familyname,
    familyinfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcI.CreateModelFamily(
      familycode,
      familyname,
      familyinfo,
      isenabled,
      createdby
    );
  };

  ListModelFamiliesLogic = async () => {
    return await this.modelSvcI.ListModelFamilies();
  };

  UpdateModelFamilyLogic = async (familycode, updateFields, updatedby) => {
    let allowedFields = ["modelfamilyname", "modelfamilyinfo", "isenabled"];
    let filteredFields = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        filteredFields[key] = value;
      }
    }

    if (Object.keys(filteredFields).length === 0) {
      throw new Error("No valid fields provided for update");
    }

    let result = await this.modelSvcI.UpdateModelFamily(
      familycode,
      filteredFields,
      updatedby
    );

    if (!result) {
      this.logger.error("Failed to update model family");
      throw new Error("Failed to update model family");
    }

    return result;
  };

  DeleteModelFamilyLogic = async (familycode, deletedby) => {
    return await this.modelSvcI.DeleteModelFamily(familycode, deletedby);
  };

  IsFamilyCodeAvailableLogic = async (familycode) => {
    return await this.modelSvcI.IsFamilyCodeAvailable(familycode);
  };

  CreateModelFamilyParamsLogic = async (
    familycode,
    paramfamilycode,
    params,
    createdby
  ) => {
    return await this.modelSvcI.CreateModelFamilyParams(
      familycode,
      paramfamilycode,
      params,
      createdby
    );
  };

  ListModelFamilyParamsLogic = async (familycode, paramfamilycode) => {
    return await this.modelSvcI.ListModelFamilyParams(
      familycode,
      paramfamilycode
    );
  };

  DeleteModelFamilyParamLogic = async (
    familycode,
    paramfamilycode,
    paramcode,
    deletedby
  ) => {
    return await this.modelSvcI.DeleteModelFamilyParam(
      familycode,
      paramfamilycode,
      paramcode,
      deletedby
    );
  };

  // vehicle model CRUD
  CreateVehicleModelLogic = async (
    modelcode,
    modelname,
    modelvariant,
    modelfamilycode,
    modeldisplayname,
    modelinfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcI.CreateVehicleModel(
      modelcode,
      modelname,
      modelvariant,
      modelfamilycode,
      modeldisplayname,
      modelinfo,
      isenabled,
      createdby
    );
  };

  ListVehicleModelsLogic = async () => {
    return await this.modelSvcI.ListVehicleModels();
  };

  UpdateVehicleModelLogic = async (modelcode, updateFields, updatedby) => {
    const allowedFields = [
      "modelname",
      "modelvariant",
      "modelfamilycode",
      "modeldisplayname",
      "modelinfo",
      "isenabled",
    ];

    const filteredFields = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        filteredFields[key] = value;
      }
    }

    if (Object.keys(filteredFields).length === 0) {
      throw new Error("No valid fields provided for update");
    }

    const result = await this.modelSvcI.UpdateVehicleModel(
      modelcode,
      filteredFields,
      updatedby
    );

    if (!result) {
      this.logger.error("Failed to update vehicle model");
      throw new Error("Failed to update vehicle model");
    }

    return result;
  };

  DeleteVehicleModelLogic = async (modelcode, deletedby) => {
    return await this.modelSvcI.DeleteVehicleModel(modelcode, deletedby);
  };

  IsModelCodeAvailableLogic = async (modelcode) => {
    return await this.modelSvcI.IsModelCodeAvailable(modelcode);
  };

  IsModelNameVariantAvailableLogic = async (modelname, modelvariant) => {
    return await this.modelSvcI.IsModelNameVariantAvailable(
      modelname,
      modelvariant
    );
  };

  GetAllModelsWithFamilyLogic = async () => {
    return await this.modelSvcI.GetAllModelsWithFamily();
  };
}
