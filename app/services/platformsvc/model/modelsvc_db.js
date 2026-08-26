export default class ModelSvcDB {
  /**
   *
   * @param {PgPool} pgPoolI
   */
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
  }

  // param family CRUD
  async createParamFamily(
    paramfamilycode,
    paramfamilyname,
    paramfamilyinfo,
    isenabled,
    createdby
  ) {
    try {
      // Check if paramfamilycode already exists
      const existingParamFamily =
        await this.isParamFamilyCodeAvailable(paramfamilycode);
      if (!existingParamFamily.isavailable) {
        const error = new Error("Param family code already exists");
        error.errcode = "PARAM_FAMILY_CODE_ALREADY_EXISTS";
        error.errdata = {
          paramfamilycode: paramfamilycode,
        };
        throw error;
      }

      let currtime = new Date();
      let query = `
                  INSERT INTO paramfamily (paramfamilycode, paramfamilyname, paramfamilyinfo, isenabled, createdat, updatedat, createdby, updatedby)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;
      let result = await this.pgPoolI.Query(query, [
        paramfamilycode,
        paramfamilyname,
        paramfamilyinfo,
        isenabled,
        currtime,
        currtime,
        createdby,
        createdby,
      ]);
      if (result.rowCount === 1) {
        return {
          paramfamilycode: paramfamilycode,
          paramfamilyname: paramfamilyname,
          paramfamilyinfo: paramfamilyinfo,
          isenabled: isenabled,
          createdat: currtime,
          updatedat: currtime,
          createdby: createdby,
          updatedby: createdby,
        };
      } else {
        throw new Error("Failed to create param family");
      }
    } catch (error) {
      throw error;
    }
  }

  async listParamFamilies() {
    try {
      let query = `
              SELECT paramfamilycode, paramfamilyname, paramfamilyinfo, isenabled, createdat, updatedat, createdby, updatedby FROM paramfamily
              ORDER BY paramfamilyname
          `;
      let result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  async updateParamFamily(paramfamilycode, updateFields, updatedby) {
    try {
      const existing = await this.isParamFamilyCodeAvailable(paramfamilycode);
      if (existing.isavailable) {
        const error = new Error("Param family code does not exist");
        error.errcode = "PARAM_FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
        };
        throw error;
      }

      let currtime = new Date();

      updateFields.updatedby = updatedby;
      updateFields.updatedat = currtime;

      let setClause = Object.keys(updateFields)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(", ");

      let query = `
        UPDATE paramfamily
        SET ${setClause}
        WHERE paramfamilycode = $1
      `;

      let params = [paramfamilycode, ...Object.values(updateFields)];

      let result = await this.pgPoolI.Query(query, params);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update param family");
      }

      return {
        paramfamilycode,
        ...updateFields,
      };
    } catch (error) {
      throw error;
    }
  }

  async deleteParamFamily(paramfamilycode) {
    try {
      // Check if paramfamilycode exists
      const existingParamFamily =
        await this.isParamFamilyCodeAvailable(paramfamilycode);
      if (existingParamFamily.isavailable) {
        const error = new Error("Param family code does not exist");
        error.errcode = "PARAM_FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
        };
        throw error;
      }

      // check if the paramfamilycode is used in any paramfamily_param
      let query = `
              SELECT paramcode FROM paramfamily_param WHERE paramfamilycode = $1
          `;
      let result = await this.pgPoolI.Query(query, [paramfamilycode]);
      if (result.rowCount > 0) {
        const error = new Error(
          "Param family code is used in some vehicle parameters: " +
            result.rows.map((row) => row.paramcode).join(", ")
        );
        error.errcode = "PARAM_FAMILY_CODE_IN_USE";
        error.errdata = {
          paramfamilycode: paramfamilycode,
          paramcodes: result.rows.map((row) => row.paramcode),
        };
        throw error;
      }

      query = `
              DELETE FROM paramfamily WHERE paramfamilycode = $1
          `;
      result = await this.pgPoolI.Query(query, [paramfamilycode]);
      if (result.rowCount === 1) {
        return {
          paramfamilycode: paramfamilycode,
          isdeleted: true,
        };
      } else {
        throw new Error("Failed to delete param family");
      }
    } catch (error) {
      throw error;
    }
  }

  async isParamFamilyCodeAvailable(paramfamilycode) {
    try {
      let query = `
              SELECT paramfamilycode FROM paramfamily WHERE paramfamilycode = $1
          `;
      let result = await this.pgPoolI.Query(query, [paramfamilycode]);
      if (result.rowCount === 0) {
        return {
          paramfamilycode: paramfamilycode,
          isavailable: true,
        };
      } else {
        return {
          paramfamilycode: paramfamilycode,
          isavailable: false,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  // model param CRUD
  async createModelParam(
    paramfamilycode,
    paramcode,
    paramname,
    paraminfo,
    isenabled,
    createdby
  ) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // Check if paramfamilycode exists
      const existingParamFamily =
        await this.isParamFamilyCodeAvailable(paramfamilycode);
      if (existingParamFamily.isavailable) {
        const error = new Error("Param family code does not exist");
        error.errcode = "PARAM_FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
        };
        throw error;
      }

      // Check if paramcode already exists within the family
      const existingParam = await this.isParamCodeAvailable(
        paramfamilycode,
        paramcode
      );
      if (!existingParam.isavailable) {
        const error = new Error("Param code already exists in this family");
        error.errcode = "PARAM_CODE_ALREADY_EXISTS";
        error.errdata = {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
        };
        throw error;
      }

      let currtime = new Date();

      // Create the parameter
      let query = `
        INSERT INTO paramfamily_param (paramfamilycode, paramcode, paramname, paraminfo, isenabled, createdat, updatedat, createdby, updatedby)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      let result = await txclient.query(query, [
        paramfamilycode,
        paramcode,
        paramname,
        paraminfo,
        isenabled,
        currtime,
        currtime,
        createdby,
        createdby,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to create model param");
      }

      // Get all existing model families
      let familiesQuery = `
        SELECT modelfamilycode FROM vehicle_modelfamily WHERE isenabled = true
      `;
      let familiesResult = await txclient.query(familiesQuery);

      // Add this parameter to all existing model families with null value
      if (familiesResult.rowCount > 0) {
        const insertPromises = familiesResult.rows.map(async (family) => {
          let insertQuery = `
            INSERT INTO vehicle_modelfamily_param 
            (modelfamilycode, paramfamilycode, paramcode, paramvalue, createdat, updatedat, createdby, updatedby)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (modelfamilycode, paramfamilycode, paramcode) DO NOTHING
          `;
          return txclient.query(insertQuery, [
            family.modelfamilycode,
            paramfamilycode,
            paramcode,
            "null",
            currtime,
            currtime,
            createdby,
            createdby,
          ]);
        });

        await Promise.all(insertPromises);
      }

      await this.pgPoolI.TxCommit(txclient);

      return {
        paramfamilycode: paramfamilycode,
        paramcode: paramcode,
        paramname: paramname,
        paraminfo: paraminfo,
        isenabled: isenabled,
        createdat: currtime,
        updatedat: currtime,
        addedtofamilies: familiesResult.rowCount,
        createdby: createdby,
        updatedby: createdby,
      };
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw error;
    }
  }

  async listModelParams() {
    try {
      let query = `
              SELECT vp.paramfamilycode, pf.paramfamilyname, vp.paramcode, vp.paramname, vp.paraminfo, vp.isenabled, vp.createdat, vp.updatedat, vp.createdby, vp.updatedby
              FROM paramfamily_param vp
              JOIN paramfamily pf ON vp.paramfamilycode = pf.paramfamilycode
              ORDER BY pf.paramfamilyname, vp.paramname
          `;
      let result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  async listModelParamsByFamily(paramfamilycode) {
    try {
      let query = `
              SELECT vp.paramfamilycode, pf.paramfamilyname, vp.paramcode, vp.paramname, vp.paraminfo, vp.isenabled, vp.createdat, vp.updatedat,  vp.createdby, vp.updatedby
              FROM paramfamily_param vp
              JOIN paramfamily pf ON vp.paramfamilycode = pf.paramfamilycode
              WHERE vp.paramfamilycode = $1
              ORDER BY vp.paramname
          `;
      let result = await this.pgPoolI.Query(query, [paramfamilycode]);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  async updateModelParam(paramfamilycode, paramcode, updateFields, updatedby) {
    try {
      // Check if param exists
      const existingParam = await this.isParamCodeAvailable(
        paramfamilycode,
        paramcode
      );
      if (existingParam.isavailable) {
        const error = new Error("Param code does not exist in this family");
        error.errcode = "PARAM_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
        };
        throw error;
      }

      let currtime = new Date();

      let fields = { ...updateFields, updatedby, updatedat: currtime };

      let keys = Object.keys(fields);
      let setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(", ");
      let values = [...Object.values(fields)];

      let query = `
        UPDATE paramfamily_param
        SET ${setClause}
        WHERE paramfamilycode = $${values.length + 1}
          AND paramcode = $${values.length + 2}
      `;

      values.push(paramfamilycode, paramcode);

      let result = await this.pgPoolI.Query(query, values);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update model param");
      }

      return {
        paramfamilycode,
        paramcode,
        ...updateFields,
        updatedby,
        updatedat: currtime,
      };
    } catch (error) {
      throw error;
    }
  }

  async deleteModelParam(paramfamilycode, paramcode) {
    try {
      // Check if param exists
      const existingParam = await this.isParamCodeAvailable(
        paramfamilycode,
        paramcode
      );
      if (existingParam.isavailable) {
        const error = new Error("Param code does not exist in this family");
        error.errcode = "PARAM_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
        };
        throw error;
      }

      // check if the param is used in any model family
      let query = `
              SELECT modelfamilycode FROM vehicle_modelfamily_param 
              WHERE paramfamilycode = $1 AND paramcode = $2
          `;
      let result = await this.pgPoolI.Query(query, [
        paramfamilycode,
        paramcode,
      ]);
      if (result.rowCount > 0) {
        const error = new Error(
          "Param is used in some model families: " +
            result.rows.map((row) => row.modelfamilycode).join(", ")
        );
        error.errcode = "PARAM_CODE_IN_USE";
        error.errdata = {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
          modelfamilycodes: result.rows.map((row) => row.modelfamilycode),
        };
        throw error;
      }

      query = `
              DELETE FROM paramfamily_param WHERE paramfamilycode = $1 AND paramcode = $2
          `;
      result = await this.pgPoolI.Query(query, [paramfamilycode, paramcode]);
      if (result.rowCount === 1) {
        return {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
          isdeleted: true,
        };
      } else {
        throw new Error("Failed to delete model param");
      }
    } catch (error) {
      throw error;
    }
  }

  async isParamCodeAvailable(paramfamilycode, paramcode) {
    try {
      let query = `
              SELECT paramcode FROM paramfamily_param 
              WHERE paramfamilycode = $1 AND paramcode = $2
          `;
      let result = await this.pgPoolI.Query(query, [
        paramfamilycode,
        paramcode,
      ]);
      if (result.rowCount === 0) {
        return {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
          isavailable: true,
        };
      } else {
        return {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
          isavailable: false,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  // family CRUD
  async createModelFamily(
    familycode,
    familyname,
    familyinfo,
    isenabled,
    createdby
  ) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // Check if familycode already exists
      const existingFamily = await this.isFamilyCodeAvailable(familycode);
      if (!existingFamily.isavailable) {
        const error = new Error("Family code already exists");
        error.errcode = "FAMILY_CODE_ALREADY_EXISTS";
        error.errdata = {
          familycode: familycode,
        };
        throw error;
      }

      let currtime = new Date();

      // Create the model family
      let query = `
        INSERT INTO vehicle_modelfamily (modelfamilycode, modelfamilyname, modelfamilyinfo, isenabled, createdat, updatedat, createdby, updatedby)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      let result = await txclient.query(query, [
        familycode,
        familyname,
        familyinfo,
        isenabled,
        currtime,
        currtime,
        createdby,
        createdby,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to create model family");
      }

      const modelFamilyResult = {
        familycode: familycode,
        familyname: familyname,
        familyinfo: familyinfo,
        isenabled: isenabled,
        createdat: currtime,
        updatedat: currtime,
        createdby: createdby,
        updatedby: createdby,
      };

      // Get all parameter families from the database
      query = `
        SELECT paramfamilycode FROM paramfamily WHERE isenabled = true
      `;
      result = await txclient.query(query);

      let totalParamsAdded = 0;
      const paramFamiliesProcessed = [];

      if (result.rowCount > 0) {
        const paramFamilies = result.rows;

        // For each param family, get all its parameters and add them
        for (const paramFamily of paramFamilies) {
          const paramfamilycode = paramFamily.paramfamilycode;

          // Get all parameters from this param family
          query = `
            SELECT paramcode, paramname FROM paramfamily_param 
            WHERE paramfamilycode = $1 AND isenabled = true
          `;
          result = await txclient.query(query, [paramfamilycode]);

          if (result.rowCount > 0) {
            const paramsToAdd = result.rows;
            let familyParamsAdded = 0;

            // Insert all parameters from this param family
            for (const param of paramsToAdd) {
              query = `
                INSERT INTO vehicle_modelfamily_param (modelfamilycode, paramfamilycode, paramcode, paramvalue, isenabled, createdat, updatedat, createdby, updatedby)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `;
              const insertResult = await txclient.query(query, [
                familycode,
                paramfamilycode,
                param.paramcode,
                "null", // default paramvalue as null
                true,
                currtime,
                currtime,
                createdby,
                createdby,
              ]);

              if (insertResult.rowCount === 1) {
                familyParamsAdded++;
                totalParamsAdded++;
              } else {
                throw new Error(
                  `Failed to add parameter ${param.paramcode} from param family ${paramfamilycode} to model family`
                );
              }
            }

            paramFamiliesProcessed.push({
              paramfamilycode: paramfamilycode,
              paramsAdded: familyParamsAdded,
            });
          }
        }
      }

      await this.pgPoolI.TxCommit(txclient);

      const finalResult = {
        ...modelFamilyResult,
        totalParamFamiliesProcessed: paramFamiliesProcessed.length,
        totalParamsAdded: totalParamsAdded,
        paramFamiliesDetails: paramFamiliesProcessed,
      };

      return finalResult;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw error;
    }
  }

  async listModelFamilies() {
    try {
      let query = `
              SELECT modelfamilycode, modelfamilyname, modelfamilyinfo, isenabled, createdat, updatedat, createdby, updatedby FROM vehicle_modelfamily
              ORDER BY modelfamilyname
          `;
      let result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  async updateModelFamily(familycode, updateFields, updatedby) {
    try {
      // Check if familycode exists
      const existingFamily = await this.isFamilyCodeAvailable(familycode);
      if (existingFamily.isavailable) {
        const error = new Error("Family code does not exist");
        error.errcode = "FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          familycode: familycode,
        };
        throw error;
      }

      let currtime = new Date();
      let fields = { ...updateFields, updatedby, updatedat: currtime };
      let keys = Object.keys(fields);
      let setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(", ");
      let values = Object.values(fields);

      let query = `
        UPDATE vehicle_modelfamily
        SET ${setClause}
        WHERE modelfamilycode = $${values.length + 1}
      `;

      values.push(familycode);
      const result = await this.pgPoolI.Query(query, values);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update model family");
      }

      return {
        familycode,
        ...updateFields,
        updatedat: currtime,
        updatedby,
      };
    } catch (error) {
      throw error;
    }
  }

  async deleteModelFamily(familycode) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      // First check if the family exists
      let query = `
              SELECT modelfamilycode FROM vehicle_modelfamily WHERE modelfamilycode = $1
          `;
      let result = await txclient.query(query, [familycode]);
      if (result.rowCount === 0) {
        const error = new Error("Model family does not exist");
        error.errcode = "FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          familycode: familycode,
        };
        throw error;
      }

      // Check if the family is used in any vehicle models
      query = `
              SELECT modelcode FROM vehicle_model WHERE modelfamilycode = $1
          `;
      result = await txclient.query(query, [familycode]);
      if (result.rowCount > 0) {
        const error = new Error(
          "Cannot delete model family. It is used by vehicle models: " +
            result.rows.map((row) => row.modelcode).join(", ")
        );
        error.errcode = "FAMILY_CODE_IN_USE";
        error.errdata = {
          familycode: familycode,
          modelcodes: result.rows.map((row) => row.modelcode),
        };
        throw error;
      }

      // delete all the model family params
      query = `
              DELETE FROM vehicle_modelfamily_param WHERE modelfamilycode = $1
          `;
      result = await txclient.query(query, [familycode]);

      // delete the model family
      query = `
              DELETE FROM vehicle_modelfamily WHERE modelfamilycode = $1
          `;
      result = await txclient.query(query, [familycode]);
      if (result.rowCount === 1) {
        await this.pgPoolI.TxCommit(txclient);
        return {
          familycode: familycode,
          isdeleted: true,
        };
      } else {
        throw new Error("Failed to delete model family");
      }
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }

  async isFamilyCodeAvailable(familycode) {
    try {
      let query = `
              SELECT modelfamilycode FROM vehicle_modelfamily WHERE modelfamilycode = $1
          `;
      let result = await this.pgPoolI.Query(query, [familycode]);
      if (result.rowCount === 0) {
        return {
          familycode: familycode,
          isavailable: true,
        };
      } else {
        return {
          familycode: familycode,
          isavailable: false,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  async createModelFamilyParams(
    familycode,
    paramfamilycode,
    params,
    createdby
  ) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let currtime = new Date();
      const results = [];

      // First check if the family code exists
      let query = `
        SELECT modelfamilycode FROM vehicle_modelfamily WHERE modelfamilycode = $1
      `;
      let result = await txclient.query(query, [familycode]);
      if (result.rowCount === 0) {
        const error = new Error("Family code does not exist");
        error.errcode = "FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          familycode: familycode,
        };
        throw error;
      }

      // Check if param family code exists
      query = `
        SELECT paramfamilycode FROM paramfamily WHERE paramfamilycode = $1
      `;
      result = await txclient.query(query, [paramfamilycode]);
      if (result.rowCount === 0) {
        const error = new Error("Param family code does not exist");
        error.errcode = "PARAM_FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
        };
        throw error;
      }

      // Validate all param codes exist in the specified param family
      const paramcodes = params.map((p) => p.paramcode);
      query = `
        SELECT paramcode FROM paramfamily_param WHERE paramfamilycode = $1 AND paramcode = ANY($2)
      `;
      result = await txclient.query(query, [paramfamilycode, paramcodes]);
      if (result.rowCount !== paramcodes.length) {
        const existingCodes = result.rows.map((row) => row.paramcode);
        const missingCodes = paramcodes.filter(
          (code) => !existingCodes.includes(code)
        );
        const error = new Error(
          `Param codes do not exist in param family ${paramfamilycode}: ${missingCodes.join(
            ", "
          )}`
        );
        error.errcode = "PARAM_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
          paramcodes: missingCodes,
        };
        throw error;
      }

      // Delete all existing family-param mappings for this family and param family combination
      query = `
        DELETE FROM vehicle_modelfamily_param WHERE modelfamilycode = $1 AND paramfamilycode = $2
      `;
      await txclient.query(query, [familycode, paramfamilycode]);

      // Insert all new parameters
      for (const param of params) {
        query = `
          INSERT INTO vehicle_modelfamily_param (modelfamilycode, paramfamilycode, paramcode, paramvalue, isenabled, createdat, updatedat, createdby, updatedby)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        result = await txclient.query(query, [
          familycode,
          paramfamilycode,
          param.paramcode,
          param.paramvalue,
          param.isenabled !== undefined ? param.isenabled : true,
          currtime,
          currtime,
          createdby,
          createdby,
        ]);

        if (result.rowCount === 1) {
          results.push({
            familycode: familycode,
            paramfamilycode: paramfamilycode,
            paramcode: param.paramcode,
            paramvalue: param.paramvalue,
            isenabled: param.isenabled !== undefined ? param.isenabled : true,
            createdat: currtime,
            updatedat: currtime,
            createdby: createdby,
            updatedby: createdby,
          });
        } else {
          throw new Error(
            `Failed to create model family param for ${param.paramcode}`
          );
        }
      }

      await this.pgPoolI.TxCommit(txclient);
      return {
        familycode: familycode,
        paramfamilycode: paramfamilycode,
        params: results,
      };
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw error;
    }
  }

  async listModelFamilyParams(familycode, paramfamilycode) {
    try {
      let query;
      let queryParams = [];

      if (familycode.toLowerCase() === "all.all.all") {
        if (paramfamilycode.toLowerCase() === "all.all.all") {
          query = `
            SELECT 
              vmfp.modelfamilycode, 
              vmf.modelfamilyname, 
              vmfp.paramfamilycode,
              pf.paramfamilyname,
              vmfp.paramcode, 
              vmfp.paramvalue, 
              vp.paramname, 
              vp.paraminfo, 
              vmfp.isenabled, 
              vmfp.createdat, 
              vmfp.updatedat,
              vmfp.createdby, 
              vmfp.updatedby
            FROM vehicle_modelfamily_param vmfp
            JOIN vehicle_modelfamily vmf ON vmfp.modelfamilycode = vmf.modelfamilycode
            JOIN paramfamily_param vp ON vmfp.paramfamilycode = vp.paramfamilycode AND vmfp.paramcode = vp.paramcode
            JOIN paramfamily pf ON vmfp.paramfamilycode = pf.paramfamilycode
            WHERE vmfp.isenabled = true
            ORDER BY vmf.modelfamilyname, pf.paramfamilyname, vp.paramname
          `;
        } else {
          // Check if param family code exists
          let checkQuery = `
            SELECT paramfamilycode FROM paramfamily WHERE paramfamilycode = $1
          `;
          let checkResult = await this.pgPoolI.Query(checkQuery, [
            paramfamilycode,
          ]);
          if (checkResult.rowCount === 0) {
            throw new Error("Param family code does not exist");
          }

          query = `
            SELECT 
              vmfp.modelfamilycode, 
              vmf.modelfamilyname, 
              vmfp.paramfamilycode,
              pf.paramfamilyname,
              vmfp.paramcode, 
              vmfp.paramvalue, 
              vp.paramname, 
              vp.paraminfo, 
              vmfp.isenabled, 
              vmfp.createdat, 
              vmfp.updatedat,
              vmfp.createdby, 
              vmfp.updatedby 
            FROM vehicle_modelfamily_param vmfp
            JOIN vehicle_modelfamily vmf ON vmfp.modelfamilycode = vmf.modelfamilycode
            JOIN paramfamily_param vp ON vmfp.paramfamilycode = vp.paramfamilycode AND vmfp.paramcode = vp.paramcode
            JOIN paramfamily pf ON vmfp.paramfamilycode = pf.paramfamilycode
            WHERE vmfp.paramfamilycode = $1 AND vmfp.isenabled = true
            ORDER BY vmf.modelfamilyname, vp.paramname
          `;
          queryParams = [paramfamilycode];
        }
      } else {
        // First check if the model family code exists
        let checkQuery = `
          SELECT modelfamilycode FROM vehicle_modelfamily WHERE modelfamilycode = $1
        `;
        let checkResult = await this.pgPoolI.Query(checkQuery, [familycode]);
        if (checkResult.rowCount === 0) {
          throw new Error("Model family code does not exist");
        }

        if (paramfamilycode.toLowerCase() === "all.all.all") {
          // Return all parameters for the specific model family
          query = `
            SELECT 
              vmfp.modelfamilycode, 
              vmf.modelfamilyname, 
              vmfp.paramfamilycode,
              pf.paramfamilyname,
              vmfp.paramcode, 
              vmfp.paramvalue, 
              vp.paramname, 
              vp.paraminfo, 
              vmfp.isenabled, 
              vmfp.createdat, 
              vmfp.updatedat,
              vmfp.createdby, 
              vmfp.updatedby 
            FROM vehicle_modelfamily_param vmfp
            JOIN vehicle_modelfamily vmf ON vmfp.modelfamilycode = vmf.modelfamilycode
            JOIN paramfamily_param vp ON vmfp.paramfamilycode = vp.paramfamilycode AND vmfp.paramcode = vp.paramcode
            JOIN paramfamily pf ON vmfp.paramfamilycode = pf.paramfamilycode
            WHERE vmfp.modelfamilycode = $1 AND vmfp.isenabled = true
            ORDER BY pf.paramfamilyname, vp.paramname
          `;
          queryParams = [familycode];
        } else {
          // Check if param family code exists
          checkQuery = `
            SELECT paramfamilycode FROM paramfamily WHERE paramfamilycode = $1
          `;
          checkResult = await this.pgPoolI.Query(checkQuery, [paramfamilycode]);
          if (checkResult.rowCount === 0) {
            throw new Error("Param family code does not exist");
          }

          // Return parameters for specific model family and specific param family
          query = `
            SELECT 
              vmfp.modelfamilycode, 
              vmf.modelfamilyname, 
              vmfp.paramfamilycode,
              pf.paramfamilyname,
              vmfp.paramcode, 
              vmfp.paramvalue, 
              vp.paramname, 
              vp.paraminfo, 
              vmfp.isenabled, 
              vmfp.createdat, 
              vmfp.updatedat,
              vmfp.createdby, 
              vmfp.updatedby 
            FROM vehicle_modelfamily_param vmfp
            JOIN vehicle_modelfamily vmf ON vmfp.modelfamilycode = vmf.modelfamilycode
            JOIN paramfamily_param vp ON vmfp.paramfamilycode = vp.paramfamilycode AND vmfp.paramcode = vp.paramcode
            JOIN paramfamily pf ON vmfp.paramfamilycode = pf.paramfamilycode
            WHERE vmfp.modelfamilycode = $1 AND vmfp.paramfamilycode = $2 AND vmfp.isenabled = true
            ORDER BY vp.paramname
          `;
          queryParams = [familycode, paramfamilycode];
        }
      }

      let result = await this.pgPoolI.Query(query, queryParams);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  async deleteModelFamilyParam(familycode, paramfamilycode, paramcode) {
    try {
      // First check if the family code exists
      let query = `
        SELECT modelfamilycode FROM vehicle_modelfamily WHERE modelfamilycode = $1
      `;
      let result = await this.pgPoolI.Query(query, [familycode]);
      if (result.rowCount === 0) {
        const error = new Error("Family code does not exist");
        error.errcode = "FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          familycode: familycode,
        };
        throw error;
      }

      // Check if the param exists in the param family
      query = `
        SELECT paramcode FROM paramfamily_param 
        WHERE paramfamilycode = $1 AND paramcode = $2
      `;
      result = await this.pgPoolI.Query(query, [paramfamilycode, paramcode]);
      if (result.rowCount === 0) {
        const error = new Error(
          `Param code ${paramcode} does not exist in param family ${paramfamilycode}`
        );
        error.errcode = "PARAM_CODE_NOT_FOUND";
        error.errdata = {
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
        };
        throw error;
      }

      // Delete the specific parameter from the model family
      query = `
        DELETE FROM vehicle_modelfamily_param 
        WHERE modelfamilycode = $1 AND paramfamilycode = $2 AND paramcode = $3
      `;
      result = await this.pgPoolI.Query(query, [
        familycode,
        paramfamilycode,
        paramcode,
      ]);
      if (result.rowCount === 1) {
        return {
          familycode: familycode,
          paramfamilycode: paramfamilycode,
          paramcode: paramcode,
          isdeleted: true,
        };
      } else {
        throw new Error(
          `Failed to delete model family param - combination ${familycode}:${paramfamilycode}:${paramcode} does not exist`
        );
      }
    } catch (error) {
      throw error;
    }
  }

  // vehicle model CRUD
  async createVehicleModel(
    modelcode,
    modelname,
    modelvariant,
    modelfamilycode,
    modeldisplayname,
    modelinfo,
    isenabled,
    createdby
  ) {
    try {
      // Check if modelcode already exists
      const existingModel = await this.isModelCodeAvailable(modelcode);
      if (!existingModel.isavailable) {
        const error = new Error("Model code already exists");
        error.errcode = "MODEL_CODE_ALREADY_EXISTS";
        error.errdata = {
          modelcode: modelcode,
        };
        throw error;
      }

      // Check if the model family exists
      const existingFamily = await this.isFamilyCodeAvailable(modelfamilycode);
      if (existingFamily.isavailable) {
        const error = new Error("Model family code does not exist");
        error.errcode = "FAMILY_CODE_NOT_FOUND";
        error.errdata = {
          modelfamilycode: modelfamilycode,
        };
        throw error;
      }

      // Check if modelname and modelvariant combination already exists
      const existingNameVariant = await this.isModelNameVariantAvailable(
        modelname,
        modelvariant
      );
      if (!existingNameVariant.isavailable) {
        const error = new Error(
          "Model name and variant combination already exists"
        );
        error.errcode = "MODEL_NAME_VARIANT_ALREADY_EXISTS";
        error.errdata = {
          modelname: modelname,
          modelvariant: modelvariant,
        };
        throw error;
      }

      let currtime = new Date();
      let query = `
                INSERT INTO vehicle_model (modelcode, modelname, modelvariant, modelfamilycode, modeldisplayname, modelinfo, isenabled, createdat, updatedat, createdby, updatedby)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `;
      let result = await this.pgPoolI.Query(query, [
        modelcode,
        modelname,
        modelvariant,
        modelfamilycode,
        modeldisplayname,
        modelinfo,
        isenabled,
        currtime,
        currtime,
        createdby,
        createdby,
      ]);
      if (result.rowCount === 1) {
        return {
          modelcode: modelcode,
          modelname: modelname,
          modelvariant: modelvariant,
          modelfamilycode: modelfamilycode,
          modeldisplayname: modeldisplayname,
          modelinfo: modelinfo,
          isenabled: isenabled,
          createdat: currtime,
          updatedat: currtime,
          createdby: createdby,
          updatedby: createdby,
        };
      } else {
        throw new Error("Failed to create vehicle model");
      }
    } catch (error) {
      throw error;
    }
  }

  async listVehicleModels() {
    try {
      let query = `
                SELECT vm.modelcode, vm.modelname, vm.modelvariant, vm.modelfamilycode, vm.modeldisplayname,
                       vmf.modelfamilyname, vm.modelinfo, vm.isenabled, vm.createdat, vm.updatedat, vm.createdby, vm.updatedby 
                FROM vehicle_model vm
                JOIN vehicle_modelfamily vmf ON vm.modelfamilycode = vmf.modelfamilycode
                ORDER BY vm.modelname, vm.modelvariant
        `;
      let result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      throw error;
    }
  }

  async updateVehicleModel(modelcode, updateFields, updatedby) {
    try {
      const existingModel = await this.isModelCodeAvailable(modelcode);
      if (existingModel.isavailable) {
        const error = new Error("Model code does not exist");
        error.errcode = "MODEL_CODE_NOT_FOUND";
        error.errdata = {
          modelcode: modelcode,
        };
        throw error;
      }

      if (updateFields.modelfamilycode) {
        const existingFamily = await this.isFamilyCodeAvailable(
          updateFields.modelfamilycode
        );
        if (existingFamily.isavailable) {
          const error = new Error("Model family code does not exist");
          error.errcode = "FAMILY_CODE_NOT_FOUND";
          error.errdata = {
            modelfamilycode: updateFields.modelfamilycode,
          };
          throw error;
        }
      }

      if (updateFields.modelname && updateFields.modelvariant) {
        const existingNameVariant =
          await this.isModelNameVariantAvailableExcluding(
            updateFields.modelname,
            updateFields.modelvariant,
            modelcode
          );
        if (!existingNameVariant.isavailable) {
          const error = new Error(
            "Model name and variant combination already exists"
          );
          error.errcode = "MODEL_NAME_VARIANT_ALREADY_EXISTS";
          error.errdata = {
            modelname: updateFields.modelname,
            modelvariant: updateFields.modelvariant,
          };
          throw error;
        }
      }

      let currtime = new Date();
      let fields = { ...updateFields, updatedby, updatedat: currtime };
      let keys = Object.keys(fields);

      let setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(", ");
      let values = Object.values(fields);

      let query = `
        UPDATE vehicle_model
        SET ${setClause}
        WHERE modelcode = $${values.length + 1}
      `;

      values.push(modelcode);

      let result = await this.pgPoolI.Query(query, values);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update vehicle model");
      }

      return {
        modelcode,
        ...updateFields,
        updatedat: currtime,
        updatedby,
      };
    } catch (error) {
      throw error;
    }
  }

  async deleteVehicleModel(modelcode) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      // First check if the model exists
      let query = `
                SELECT modelcode FROM vehicle_model WHERE modelcode = $1
        `;
      let result = await txclient.query(query, [modelcode]);
      if (result.rowCount === 0) {
        const error = new Error("Vehicle model does not exist");
        error.errcode = "MODEL_CODE_NOT_FOUND";
        error.errdata = {
          modelcode: modelcode,
        };
        throw error;
      }

      // Check if the model is used in any vehicles
      query = `
                SELECT vinno FROM vehicle WHERE modelcode = $1
        `;
      result = await txclient.query(query, [modelcode]);
      if (result.rowCount > 0) {
        const error = new Error(
          "Cannot delete vehicle model. It is used by vehicles: " +
            result.rows.map((row) => row.vinno).join(", ")
        );
        error.errcode = "MODEL_CODE_IN_USE";
        error.errdata = {
          modelcode: modelcode,
          vinno: result.rows.map((row) => row.vinno),
        };
        throw error;
      }

      // Check if the model is used in any vehicle_model_alert_dst
      query = `
                SELECT modelcode FROM vehicle_model_alert_dst WHERE modelcode = $1
        `;
      result = await txclient.query(query, [modelcode]);
      if (result.rowCount > 0) {
        const error = new Error(
          "Cannot delete vehicle model. It has alert configurations. Please delete alert configurations first."
        );
        error.errcode = "MODEL_CODE_IN_USE";
        error.errdata = {
          modelcode: modelcode,
          modelcode: result.rows.map((row) => row.modelcode),
        };
        throw error;
      }

      // delete the vehicle model
      query = `
                DELETE FROM vehicle_model WHERE modelcode = $1
        `;
      result = await txclient.query(query, [modelcode]);
      if (result.rowCount === 1) {
        await this.pgPoolI.TxCommit(txclient);
        return {
          modelcode: modelcode,
          isdeleted: true,
        };
      } else {
        throw new Error("Failed to delete vehicle model");
      }
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }

  async isModelCodeAvailable(modelcode) {
    try {
      let query = `
                SELECT modelcode FROM vehicle_model WHERE modelcode = $1
        `;
      let result = await this.pgPoolI.Query(query, [modelcode]);
      if (result.rowCount === 0) {
        return {
          modelcode: modelcode,
          isavailable: true,
        };
      } else {
        return {
          modelcode: modelcode,
          isavailable: false,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  async isModelNameVariantAvailable(modelname, modelvariant) {
    try {
      let query = `
                SELECT modelcode FROM vehicle_model WHERE modelname = $1 AND modelvariant = $2
        `;
      let result = await this.pgPoolI.Query(query, [modelname, modelvariant]);
      if (result.rowCount === 0) {
        return {
          modelname: modelname,
          modelvariant: modelvariant,
          isavailable: true,
        };
      } else {
        return {
          modelname: modelname,
          modelvariant: modelvariant,
          isavailable: false,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  async isModelNameVariantAvailableExcluding(
    modelname,
    modelvariant,
    excludeModelcode
  ) {
    try {
      let query = `
                SELECT modelcode FROM vehicle_model WHERE modelname = $1 AND modelvariant = $2 AND modelcode != $3
        `;
      let result = await this.pgPoolI.Query(query, [
        modelname,
        modelvariant,
        excludeModelcode,
      ]);
      if (result.rowCount === 0) {
        return {
          modelname: modelname,
          modelvariant: modelvariant,
          isavailable: true,
        };
      } else {
        return {
          modelname: modelname,
          modelvariant: modelvariant,
          isavailable: false,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  async getAllModelsWithFamily() {
    try {
      let query = `
        SELECT DISTINCT modelname as model, modelvariant as variant 
        FROM vehicle_model
        GROUP BY modelname, modelvariant 
        ORDER BY modelname
      `;

      let result = await this.pgPoolI.Query(query);

      const modelinfo = [];
      const familyinfo = [];
      const familyMap = new Map();

      for (const row of result.rows) {
        const model = row.model;
        const variant = row.variant || "default";

        let familycode, familyname;
        if (model === "a301") {
          familycode = "a301";
          familyname = "A301";
        } else if (model === "eJeeto") {
          familycode = "ejeeto";
          familyname = "EJeeto";
        } else {
          familycode = "treo";
          familyname = "Treo";
        }

        if (!familyMap.has(familycode)) {
          familyinfo.push({
            familycode: familycode,
            familyname: familyname,
          });
          familyMap.set(familycode, true);
        }

        let modelcode;
        if (variant === "" || variant === null) {
          modelcode = model.toLowerCase().replace(/\s+/g, "") + "_default";
        } else {
          modelcode =
            model.toLowerCase().replace(/\s+/g, "") +
            "_" +
            variant.toLowerCase().replace(/\s+/g, "");
        }

        modelinfo.push({
          model: model,
          variant: variant,
          modelcode: modelcode,
          modelfamilycode: familycode,
        });
      }

      return {
        modelinfo: modelinfo,
        familyinfo: familyinfo,
      };
    } catch (error) {
      throw error;
    }
  }

  async getModelCodeByNameAndVariant(modelname, modelvariant) {
    try {

      const modelcodewithunderscore = `${modelname
        .toLowerCase()
        .replace(/\s+/g, "")}_${modelvariant
        .toLowerCase()
        .replace(/\s+/g, "")}`;

      const modelcodewithoutunderscore = `${modelname
        .toLowerCase()
        .replace(/\s+/g, "") + modelvariant
        .toLowerCase()
        .replace(/\s+/g, "")}`;

      let query = `
        SELECT modelcode FROM vehicle_model 
        WHERE modelcode = $1 OR modelcode = $2
      `;
      let result = await this.pgPoolI.Query(query, [modelcodewithunderscore, modelcodewithoutunderscore]);

      if (result.rowCount === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      throw error;
    }
  }
}
