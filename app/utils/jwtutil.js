import jwt from "jsonwebtoken";

export async function GetUnVerifiedClaims(token) {
    return jwt.decode(token, {
        json: true
    });
}
