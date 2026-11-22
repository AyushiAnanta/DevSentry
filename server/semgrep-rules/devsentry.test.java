import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;

class SqlRuleTest {
    ResultSet unsafe(Statement statement, String userId) throws Exception {
        String sql = "SELECT * FROM users WHERE id = '" + userId + "'";
        // ruleid: devsentry.sql-string-concat-java
        return statement.executeQuery(sql);
    }

    PreparedStatement safe(Connection connection) throws Exception {
        return connection.prepareStatement("SELECT * FROM users WHERE id = ?"); // ok: devsentry.sql-string-concat-java
    }
}

class JavaStringEqualityRuleTest {
    boolean unsafe(String role) {
        // ruleid: devsentry.java-string-reference-equality
        return role == "admin";
    }

    boolean safe(String role) {
        return role.equals("admin"); // ok: devsentry.java-string-reference-equality
    }

    boolean primitiveEqualityIsSafe(int left, int right) {
        return left == right; // ok: devsentry.java-string-reference-equality
    }
}
