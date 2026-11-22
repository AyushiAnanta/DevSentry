interface Database {
  query(sql: string, values?: unknown[]): unknown;
}

function sqlConcatenationMustBeReported(db: Database, userId: string): unknown {
  const sql = "SELECT * FROM users WHERE id = '" + userId + "'";
  // ruleid: devsentry.sql-string-concat
  return db.query(sql);
}

function parameterizedQueryIsSafe(db: Database, userId: string): unknown {
  return db.query('SELECT * FROM users WHERE id = ?', [userId]); // ok: devsentry.sql-string-concat
}

function swallowedErrorMustBeReported(): void {
  try {
    throw new Error('failure');
  // ruleid: devsentry.empty-catch
  } catch (error) {
    void error;
  }
}

function rethrownErrorIsHandled(): void {
  try {
    throw new Error('failure');
  // ok: devsentry.empty-catch
  } catch (error) {
    throw error;
  }
}

function loggedErrorIsHandled(logger: { error: (error: unknown) => void }): void {
  try {
    throw new Error('failure');
  // ok: devsentry.empty-catch
  } catch (error) {
    logger.error(error);
  }
}

function returnedErrorIsHandled(): unknown {
  try {
    throw new Error('failure');
  // ok: devsentry.empty-catch
  } catch (error) {
    return error;
  }
}

function passedErrorIsHandled(reportError: (error: unknown) => void): void {
  try {
    throw new Error('failure');
  // ok: devsentry.empty-catch
  } catch (error) {
    reportError(error);
  }
}

function usedErrorIsHandled(errorMetrics: { capture: (error: unknown) => void }): void {
  try {
    throw new Error('failure');
  // ok: devsentry.empty-catch
  } catch (error) {
    errorMetrics.capture(error);
  }
}
