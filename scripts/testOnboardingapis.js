
import fs from "fs";
import path from "path";
import axios from "axios";

export async function testInternalOnboardVehicle(platformHdlrI, pgPoolTx, createdby) {
    try {
      const query = `SELECT vin, customercontactmobile, vehiclecity, dealer, delivereddate, engineno, fueltype, licenseplate, vehiclecolour, vehiclemodel, vehiclevariant, retailssaledate FROM nemo2.dms_data where customertype = 'Individual'`;
      const result = await pgPoolTx.query(query);
      console.log(`Found ${result.rows.length} vehicles to onboard`);
      for (const vehicle of result.rows) {
        try {
          const vehicleData = {
            vin: vehicle.vin,
            vehicleModel: vehicle.vehiclemodel || "TREO",
            vehicleVariant: vehicle.vehiclevariant || "hrt",
            tgu_imei_no: "123456789012345",
            mobileNo: vehicle.customercontactmobile,
            dealer: vehicle.dealer,
            deliveredDate: vehicle.delivereddate,
            engineNo: vehicle.engineno,
            fuelType: vehicle.fueltype,
            licensePlate: vehicle.licenseplate,
            retailsSaleDate: vehicle.retailssaledate,
            vehicleCity: vehicle.vehiclecity,
            vehicleColour: vehicle.vehiclecolour,
          };
  
          // Call the OnboardVehicleLogic directly
          const onboardResult =
            await platformHdlrI.vehicleHdlr.vehicleHdlrImpl.OnboardVehicleLogic(
              vehicleData,
              createdby
            );
  
          console.log(
            `Successfully onboarded vehicle: ${vehicle.vin}`,
            onboardResult
          );
        } catch (error) {
          console.error(
            `Failed to onboard vehicle ${vehicle.vin}:`,
            error.message
          );
          // Continue with next vehicle instead of stopping
        }
      }
    } catch (error) {
      console.error(`Error executing query: ${error.message}`);
      throw new Error(`Failed to execute query: ${error.message}`);
    }
  }
  
  export async function testInternalOnboardUserAccount(
    platformHdlrI,
    pgPoolTx,
    createdby
  ) {
    try {
      const query = `SELECT corporatetype, customeraddress, customeraddresscity, customeraddresscountry, customeraddresspincode, customercontactemail, customercontactmobile, customerdateofbirth, customergender, customername, customertype, nemo_user_mobile, licenseplate, vin FROM nemo2.dms_data where customertype = 'Individual'`;
      const result = await pgPoolTx.query(query);
      console.log(`Found ${result.rows.length} data to onboard`);
      for (const data of result.rows) {
        const onboardResult =
          await platformHdlrI.pUserHdlr.pUserHdlrImpl.OnboardUserAccountLogic(
            createdby,
            data.corporatetype,
            data.customeraddress,
            data.customeraddresscity,
            data.customeraddresscountry,
            data.customeraddresspincode,
            data.customercontactemail,
            data.customercontactmobile,
            data.customerdateofbirth,
            data.customergender,
            data.customername,
            data.customertype,
            data.licenseplate,
            data.vin,
            data.nemo_user_mobile
          );
        console.log(
          `Successfully onboarded user account: ${data.nemo_user_mobile}`,
          onboardResult
        );
      }
    } catch (error) {
      console.error(`Error executing query: ${error.message}`);
      throw new Error(`Failed to execute query: ${error.message}`);
    }
  }
  

  export async function testOnboardVehicle(platformHdlrI, pgPoolTx, createdby) {
    try {
      const query = `SELECT vin, customercontactmobile, vehiclecity, dealer, delivereddate, engineno, fueltype, licenseplate, vehiclecolour, vehiclemodel, vehiclevariant, retailssaledate FROM nemo2.dms_data where customertype = 'Individual' and vehiclecity!='BANGALORE' limit 50`;
      const result = await pgPoolTx.query(query);
      console.log(`Found ${result.rows.length} vehicles to onboard`);
      const authToken = await axios.post(
        `https://nemo.mahindralastmilemobility.com/api/v1/fms/public/superadmin/token`,
        {
          "email": "onboarding@nemo3.com",
          "password": "69f9f7c745883a32502dc7d9d67b16aaa09ea9d0b19de202555cf8e1b42be693"
        }
      );
      for (const vehicle of result.rows) {
        try {
          const vehicleData = {
            vin: vehicle.vin,
            vehicleModel: vehicle.vehiclemodel || "TREO",
            vehicleVariant: vehicle.vehiclevariant || "hrt",
            tgu_imei_no: "123456789012345",
            mobileNo: vehicle.customercontactmobile,
            dealer: vehicle.dealer,
            deliveredDate: vehicle.delivereddate,
            engineNo: vehicle.engineno,
            fuelType: vehicle.fueltype,
            licensePlate: vehicle.licenseplate,
            retailsSaleDate: vehicle.retailssaledate,
            vehicleCity: vehicle.vehiclecity,
            vehicleColour: vehicle.vehiclecolour,
          };
          // Call the OnboardVehicleLogic directly
          
          const onboardResult = await axios.post(
            `https://nemo.mahindralastmilemobility.com/api/v1/platform/vehicle/onboardvehicle`,
            vehicleData,
            {
              headers: {
                "Content-Type": "application/json",
                "cookie": `token=${authToken.data.data.token}; refreshtoken=${authToken.data.data.refreshtoken}`,
              },
            }
          );
          console.log(
            `Successfully onboarded vehicle: ${vehicle.vin}`,
            onboardResult.data
          );
        } catch (error) {
          console.error(
            `Failed to onboard vehicle ${vehicle.vin}:`,
            error.message
          );
          // Continue with next vehicle instead of stopping
        }
      }
    } catch (error) {
      console.error(`Error executing query: ${error.message}`);
      throw new Error(`Failed to execute query: ${error.message}`);
    }
  }
  
  export async function testOnboardUserAccount(
    platformHdlrI,
    pgPoolTx,
    createdby
  ) {
    try {
      const query = `SELECT corporatetype, customeraddress, customeraddresscity, customeraddresscountry, customeraddresspincode, customercontactemail, customercontactmobile, customerdateofbirth, customergender, customername, customertype, nemo_user_mobile, licenseplate, vin FROM nemo2.dms_data where customertype = 'Individual' and customeraddresscity!='BANGALORE' limit 50`;
      const result = await pgPoolTx.query(query);
      console.log(`Found ${result.rows.length} data to onboard`);
      const authToken = await axios.post(
        `https://nemo.mahindralastmilemobility.com/api/v1/fms/public/superadmin/token`,
        {
          "email": "onboarding@nemo3.com",
          "password": "69f9f7c745883a32502dc7d9d67b16aaa09ea9d0b19de202555cf8e1b42be693"
        }
      );
      for (const data of result.rows) {
        const onboardResult = await axios.post(
          `https://nemo.mahindralastmilemobility.com/api/v1/platform/user/onboarduseraccount`,
          {
            "corporatetype": data.corporatetype,
            "customeraddress": data.customeraddress,
            "customeraddresscity": data.customeraddresscity,
            "customeraddresscountry": data.customeraddresscountry,
            "customeraddresspincode": data.customeraddresspincode,
            "customercontactemail": data.customercontactemail,
            "customercontactmobile": data.customercontactmobile,
            "customerdateofbirth": data.customerdateofbirth,
            "customergender": data.customergender,
            "customername": data.customername,
            "customertype": data.customertype,
            "licenseplate": data.licenseplate,
            "vin": data.vin,
            "nemo_user_mobile": data.nemo_user_mobile
          },
          {
            headers: {
              "Content-Type": "application/json",
              "cookie": `token=${authToken.data.data.token}; refreshtoken=${authToken.data.data.refreshtoken}`,
            },
          }
        );
        console.log(
          `Successfully onboarded user account: ${data.nemo_user_mobile}`,
          onboardResult.data
        );
      }
    } catch (error) {
      console.error(`Error executing query: ${error.message}`);
      throw new Error(`Failed to execute query: ${error.message}`);
    }
  }
  
  
  
  export async function updateVehicleModelVariant(pgPoolTx) {
    try {
      // Read CSV data
      const csvFilePath = path.join(
        process.cwd(),
        "scripts",
        "seed_csv_files",
        "vehicle_models_updated.csv"
      );
      
      if (!fs.existsSync(csvFilePath)) {
        throw new Error(`CSV file not found at ${csvFilePath}`);
      }
      
      const csvContent = fs.readFileSync(csvFilePath, "utf8");
      const lines = csvContent.split("\n").filter((line) => line.trim() !== "");
      
      // Skip header
      const csvData = lines.slice(1);
      
      console.log(`Found ${csvData.length} vehicle models in CSV`);
      
      // Get all vehicles from database
      const vehicleQuery = `SELECT vinno, vehiclemodel, vehiclevariant FROM seedfmscoresch.vehicle`;
      const vehicleResult = await pgPoolTx.query(vehicleQuery);
      
      console.log(`Found ${vehicleResult.rows.length} vehicles in database`);
      
      let updatedCount = 0;
      let skippedCount = 0;
      
      for (const vehicle of vehicleResult.rows) {
        const { vinno, vehiclemodel: dbModel, vehiclevariant: dbVariant } = vehicle;
        
        let bestMatch = null;
        let bestScore = 0;
        
        // Find best match from CSV
        for (const line of csvData) {
          const columns = parseCSVLine(line);
          if (columns.length < 3) continue;
          
          const csvModel = columns[0].trim();
          const csvVariant = columns[2].trim();
          
          // Calculate match score
          const score = calculateMatchScore(dbModel, dbVariant, csvModel, csvVariant);
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = { csvModel, csvVariant };
          }
        }
        
        if (bestMatch && bestScore > 0) {
          // Update the vehicle
          const updateQuery = `
            UPDATE seedfmscoresch.vehicle 
            SET vehiclemodel = $1, vehiclevariant = $2, updatedat = $3
            WHERE vinno = $4
          `;
          
          await pgPoolTx.query(updateQuery, [
            bestMatch.csvModel,
            bestMatch.csvVariant,
            new Date(),
            vinno
          ]);
          
          console.log(`Updated VIN ${vinno}: ${dbModel} ${dbVariant} -> ${bestMatch.csvModel} ${bestMatch.csvVariant} (score: ${bestScore})`);
          updatedCount++;
        } else {
          console.log(`No match found for VIN ${vinno}: ${dbModel} ${dbVariant}`);
          skippedCount++;
        }
        
        // Only create result object if bestMatch exists
        if (bestMatch) {
          const result = {
            vinno: vinno,
            oldModel: dbModel,
            oldVariant: dbVariant,
            newModel: bestMatch.csvModel,
            newVariant: bestMatch.csvVariant,
            score: bestScore
          };
          console.log('bestMatch', result);
        } else {
          console.log(`Skipped VIN ${vinno} - no match found`);
        }
      }
      
      console.log(`\nUpdate Summary:`);
      console.log(`- Updated: ${updatedCount} vehicles`);
      console.log(`- Skipped: ${skippedCount} vehicles`);
      console.log(`- Total processed: ${vehicleResult.rows.length} vehicles`);
      
    } catch (error) {
      console.error(`Error updating vehicle model/variant: ${error.message}`);
      throw new Error(`Failed to update vehicle model/variant: ${error.message}`);
    }
  }
  
  function calculateMatchScore(dbModel, dbVariant, csvModel, csvVariant) {
    let score = 0;
    
    // Normalize strings for comparison
    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    const normDbModel = normalize(dbModel);
    const normDbVariant = normalize(dbVariant);
    const normCsvModel = normalize(csvModel);
    const normCsvVariant = normalize(csvVariant);
    
    // Exact match gets highest score
    if (normDbModel === normCsvModel && normDbVariant === normCsvVariant) {
      return 100;
    }
    
    // Model matching
    if (normDbModel === normCsvModel) {
      score += 50;
    } else {
      // Partial model match
      const modelWords = normDbModel.split(/\s+/);
      const csvModelWords = normCsvModel.split(/\s+/);
      
      for (const word of modelWords) {
        if (word.length > 2 && csvModelWords.some(csvWord => csvWord.includes(word) || word.includes(csvWord))) {
          score += 10;
        }
      }
    }
    
    // Variant matching
    if (normDbVariant === normCsvVariant) {
      score += 30;
    } else {
      // Partial variant match
      const variantWords = normDbVariant.split(/\s+/);
      const csvVariantWords = normCsvVariant.split(/\s+/);
      
      for (const word of variantWords) {
        if (word.length > 2 && csvVariantWords.some(csvWord => csvWord.includes(word) || word.includes(csvWord))) {
          score += 5;
        }
      }
    }
    
    // Special cases for common patterns
    if (normDbModel.includes('treo') && normCsvModel.includes('treo')) {
      score += 20;
    }
    if (normDbModel.includes('zeo') && normCsvModel.includes('zeo')) {
      score += 20;
    }
    if (normDbModel.includes('zor') && normCsvModel.includes('zor')) {
      score += 20;
    }
    
    return score;
  }
  