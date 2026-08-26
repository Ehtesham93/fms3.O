import axios from "axios";

export const validateAllInputs = (schema, data) => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error.errors && Array.isArray(error.errors)) {
      const allErrors = error.errors.map((err) => {
        let field = "root";
        if (err.path.length > 0) {
          const lastKey = err.path
            .slice()
            .reverse()
            .find((p) => typeof p === "string");
          field = lastKey || err.path.join(".");
        }

        return {
          field: field,
          errorCode: err.code,
          message: err.message,
        };
      });

      let message;
      if (allErrors.length === 1) {
        message = allErrors[0].message;
      } else if (allErrors.length <= 3) {
        const errorMessages = allErrors.map((err) => err.message);
        message = errorMessages.join(", ");
      } else {
        message = `Please fix ${allErrors.length} validation errors and try again.`;
      }

      throw {
        errcode: "INPUT_ERROR",
        errdata: allErrors,
        message: message,
      };
    }

    throw error;
  }
};

export const ValidateCaptcha = async (captchaToken, remoteIp, config) => {
  const response = await axios.post(config.recaptcha.siteurl, null, {
    params: {
      secret: config.recaptcha.secretkey,
      response: captchaToken,
      remoteip: remoteIp,
    },
  });

  return response.data.success;
};
