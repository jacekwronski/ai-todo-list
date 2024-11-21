import pg from "pg";

function Database(connection, logger) {
  this.pool = new pg.Pool(connection);
  this.logger = logger;

  this.query = async (query, params, formatResult = (x) => x) => {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query(query, params);
      return rows.map(formatResult);
    } catch (err) {
      this.logger.logError("Error during DB query", { query, params, err });
      throw err;
    } finally {
      client.release();
    }
  };
}

export default Database;
