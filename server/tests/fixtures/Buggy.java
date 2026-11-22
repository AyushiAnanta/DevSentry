import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

public class Buggy {
    public ResultSet loadUser(Connection connection, String userId) throws Exception {
        Statement statement = connection.createStatement();
        String sql = "SELECT * FROM users WHERE id = '" + userId + "'";
        return statement.executeQuery(sql);
    }

    public int average(int total, int count) {
        return total / (count - 1);
    }

    public boolean isAdmin(String role) {
        return role == "admin";
    }
}
