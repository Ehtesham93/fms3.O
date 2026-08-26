import ModelSvcDB from "./modelsvc_db.js";

export default class ModelSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.modelSvcDB = new ModelSvcDB(pgPoolI, logger);
  }

  // param family CRUD
  CreateParamFamily = async (
    paramfamilycode,
    paramfamilyname,
    paramfamilyinfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcDB.createParamFamily(
      paramfamilycode,
      paramfamilyname,
      paramfamilyinfo,
      isenabled,
      createdby
    );
  };

  ListParamFamilies = async () => {
    return await this.modelSvcDB.listParamFamilies();
  };

  UpdateParamFamily = async (paramfamilycode, updateFields, updatedby) => {
    return await this.modelSvcDB.updateParamFamily(
      paramfamilycode,
      updateFields,
      updatedby
    );
  };

  DeleteParamFamily = async (paramfamilycode, deletedby) => {
    return await this.modelSvcDB.deleteParamFamily(paramfamilycode, deletedby);
  };

  IsParamFamilyCodeAvailable = async (paramfamilycode) => {
    return await this.modelSvcDB.isParamFamilyCodeAvailable(paramfamilycode);
  };

  // model param CRUD
  CreateModelParam = async (
    paramfamilycode,
    paramcode,
    paramname,
    paraminfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcDB.createModelParam(
      paramfamilycode,
      paramcode,
      paramname,
      paraminfo,
      isenabled,
      createdby
    );
  };

  ListModelParams = async () => {
    return await this.modelSvcDB.listModelParams();
  };

  ListModelParamsByFamily = async (paramfamilycode) => {
    return await this.modelSvcDB.listModelParamsByFamily(paramfamilycode);
  };

  UpdateModelParam = async (
    paramfamilycode,
    paramcode,
    updateFields,
    updatedby
  ) => {
    return await this.modelSvcDB.updateModelParam(
      paramfamilycode,
      paramcode,
      updateFields,
      updatedby
    );
  };

  DeleteModelParam = async (paramfamilycode, paramcode, deletedby) => {
    return await this.modelSvcDB.deleteModelParam(
      paramfamilycode,
      paramcode,
      deletedby
    );
  };

  IsParamCodeAvailable = async (paramfamilycode, paramcode) => {
    return await this.modelSvcDB.isParamCodeAvailable(
      paramfamilycode,
      paramcode
    );
  };

  // family CRUD
  CreateModelFamily = async (
    familycode,
    familyname,
    familyinfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcDB.createModelFamily(
      familycode,
      familyname,
      familyinfo,
      isenabled,
      createdby
    );
  };

  ListModelFamilies = async () => {
    return await this.modelSvcDB.listModelFamilies();
  };

  UpdateModelFamily = async (familycode, updateFields, updatedby) => {
    return await this.modelSvcDB.updateModelFamily(
      familycode,
      updateFields,
      updatedby
    );
  };

  DeleteModelFamily = async (familycode, deletedby) => {
    return await this.modelSvcDB.deleteModelFamily(familycode, deletedby);
  };

  IsFamilyCodeAvailable = async (familycode) => {
    return await this.modelSvcDB.isFamilyCodeAvailable(familycode);
  };

  CreateModelFamilyParams = async (
    familycode,
    paramfamilycode,
    params,
    createdby
  ) => {
    return await this.modelSvcDB.createModelFamilyParams(
      familycode,
      paramfamilycode,
      params,
      createdby
    );
  };

  ListModelFamilyParams = async (familycode, paramfamilycode) => {
    return await this.modelSvcDB.listModelFamilyParams(
      familycode,
      paramfamilycode
    );
  };

  DeleteModelFamilyParam = async (
    familycode,
    paramfamilycode,
    paramcode,
    deletedby
  ) => {
    return await this.modelSvcDB.deleteModelFamilyParam(
      familycode,
      paramfamilycode,
      paramcode,
      deletedby
    );
  };

  // vehicle model CRUD
  CreateVehicleModel = async (
    modelcode,
    modelname,
    modelvariant,
    modelfamilycode,
    modeldisplayname,
    modelinfo,
    isenabled,
    createdby
  ) => {
    return await this.modelSvcDB.createVehicleModel(
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

  ListVehicleModels = async () => {
    return await this.modelSvcDB.listVehicleModels();
  };

  UpdateVehicleModel = async (modelcode, updateFields, updatedby) => {
    return await this.modelSvcDB.updateVehicleModel(
      modelcode,
      updateFields,
      updatedby
    );
  };

  DeleteVehicleModel = async (modelcode, deletedby) => {
    return await this.modelSvcDB.deleteVehicleModel(modelcode, deletedby);
  };

  IsModelCodeAvailable = async (modelcode) => {
    return await this.modelSvcDB.isModelCodeAvailable(modelcode);
  };

  IsModelNameVariantAvailable = async (modelname, modelvariant) => {
    return await this.modelSvcDB.isModelNameVariantAvailable(
      modelname,
      modelvariant
    );
  };

  GetAllModelsWithFamily = async () => {
    return await this.modelSvcDB.getAllModelsWithFamily();
  };

  GetModelCodeByNameAndVariant = async (modelname, modelvariant) => {
    return await this.modelSvcDB.getModelCodeByNameAndVariant(
      modelname,
      modelvariant
    );
  };
}
