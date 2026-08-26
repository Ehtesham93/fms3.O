export default class EmailSvcDB {
    constructor(pgPoolI) {
        this.pgPoolI = pgPoolI;
    }
 
    async getPendingEmails() {
        try{
        let query = `
            SELECT id, email, nextattempt, nretriespending FROM pending_email
        `;
        let result = await this.pgPoolI.Query(query);
        if (result.rowCount === 0) {
            return [];
        }
        return result.rows;
     } catch (error) {
        throw new Error(`Failed to retrieve pending emails`);
    }
    }

    async deletePendingEmail(id) {
        try{
        let query = `
            DELETE FROM pending_email WHERE id = $1
        `;
        let result = await this.pgPoolI.Query(query, [id]);
        if (result.rowCount !== 1) {
            throw new Error("Failed to delete pending email");
        }
        return true;
     } catch (error) {
        throw new Error(`Failed to delete pending email`);
    }
    }
    
    async updatePendingEmail(id, nextattempt) {
        try{
        let query = `
            UPDATE pending_email SET nextattempt = $1, nretriespending = nretriespending - 1 WHERE id = $2
        `;
        let result = await this.pgPoolI.Query(query, [nextattempt, id]);
        if (result.rowCount !== 1) {
            throw new Error("Failed to update pending email");
        }
        return true;
    }catch(error){
        throw new Error(`Failed to update pending email`);
    }
    }
}